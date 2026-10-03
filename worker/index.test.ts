import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker, { pinMatches, type Env } from './index'

const PIN = '424242'

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    NUKI_API_TOKEN: 'token',
    NUKI_SMARTLOCK_ID: '123',
    ACCESS_PIN: PIN,
    ...overrides,
  }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://door.example.com/api/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const nukiOk = () => new Response(null, { status: 204 })

/** Resolves a request that sleeps between retries, advancing fake timers until it settles. */
async function settle(pending: Promise<Response>): Promise<Response> {
  let done = false
  void pending.then(() => (done = true), () => (done = true))
  for (let i = 0; i < 50 && !done; i++) await vi.advanceTimersByTimeAsync(500)
  return pending
}

describe('pinMatches', () => {
  it('accepts equal and rejects different PINs', async () => {
    expect(await pinMatches('424242', '424242')).toBe(true)
    expect(await pinMatches('424243', '424242')).toBe(false)
    expect(await pinMatches('', '424242')).toBe(false)
  })
})

describe('POST /api/open', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('triggers the Opener buzzer (action 3) with the right PIN', async () => {
    fetchMock.mockResolvedValue(nukiOk())
    const res = await worker.fetch(post({ pin: PIN }), makeEnv())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.nuki.io/smartlock/123/action')
    expect(init?.method).toBe('POST')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token')
    expect(JSON.parse(init?.body as string)).toEqual({ action: 3 })
  })

  it('honours NUKI_ACTION', async () => {
    fetchMock.mockResolvedValue(nukiOk())
    await worker.fetch(post({ pin: PIN }), makeEnv({ NUKI_ACTION: '1' }))
    expect(JSON.parse(fetchMock.mock.calls[0]![1]?.body as string)).toEqual({ action: 1 })
  })

  it('rejects a wrong PIN without calling Nuki', async () => {
    const res = await worker.fetch(post({ pin: '000000' }), makeEnv())
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects malformed bodies', async () => {
    expect((await worker.fetch(post('not json'), makeEnv())).status).toBe(400)
    expect((await worker.fetch(post({ pin: 123456 }), makeEnv())).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('only allows POST', async () => {
    const res = await worker.fetch(new Request('https://door.example.com/api/open'), makeEnv())
    expect(res.status).toBe(405)
  })

  it('rejects foreign and "null" origins', async () => {
    const foreign = await worker.fetch(post({ pin: PIN }, { origin: 'https://evil.example' }), makeEnv())
    const nullish = await worker.fetch(post({ pin: PIN }, { origin: 'null' }), makeEnv())
    expect(foreign.status).toBe(403)
    expect(nullish.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts the own origin', async () => {
    fetchMock.mockResolvedValue(nukiOk())
    const res = await worker.fetch(post({ pin: PIN }, { origin: 'https://door.example.com' }), makeEnv())
    expect(res.status).toBe(200)
  })

  it('fails closed when not configured or the PIN is too short', async () => {
    expect((await worker.fetch(post({ pin: PIN }), makeEnv({ NUKI_API_TOKEN: '' }))).status).toBe(503)
    expect((await worker.fetch(post({ pin: '1234' }), makeEnv({ ACCESS_PIN: '1234' }))).status).toBe(503)
    expect((await worker.fetch(post({ pin: PIN }), makeEnv({ NUKI_ACTION: '9' }))).status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a PIN with exactly the minimum length', async () => {
    fetchMock.mockResolvedValue(nukiOk())
    const res = await worker.fetch(post({ pin: '12345' }), makeEnv({ ACCESS_PIN: '12345' }))
    expect(res.status).toBe(200)
  })

  it('returns 429 when rate limited, before checking the PIN', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const res = await worker.fetch(post({ pin: PIN }), makeEnv({ RATE_LIMITER: { limit } as unknown as RateLimit }))
    expect(res.status).toBe(429)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries on 5xx and then succeeds', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 })).mockResolvedValueOnce(nukiOk())
    const res = await settle(worker.fetch(post({ pin: PIN }), makeEnv()))
    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns 502 after repeated failures', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new Error('network'))
    const res = await settle(worker.fetch(post({ pin: PIN }), makeEnv()))
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not retry on 401 from Nuki (bad token)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    const res = await worker.fetch(post({ pin: PIN }), makeEnv())
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('routing', () => {
  it('returns 404 JSON for unknown API routes and serves assets otherwise', async () => {
    const env = makeEnv()
    expect((await worker.fetch(new Request('https://door.example.com/api/nope'), env)).status).toBe(404)
    const page = await worker.fetch(new Request('https://door.example.com/'), env)
    expect(await page.text()).toBe('asset')
  })
})
