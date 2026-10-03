import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decide, recordOpen } from './guard'
import worker, { clientKey, pinMatches, type Env } from './index'
import { MemoryGuardStore } from './test/memory-store'

const PIN = '424242'

/** GUARD binding backed by the real decision logic and an in-memory store. */
function makeGuard(store = new MemoryGuardStore()) {
  const stub = {
    attempt: async (client: string, pinOk: boolean) => decide(store, client, pinOk, Date.now()),
    opened: async () => recordOpen(store, Date.now()),
  }
  return { idFromName: () => 'global', get: () => stub } as unknown as Env['GUARD']
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('asset') } as unknown as Fetcher,
    GUARD: makeGuard(),
    NUKI_API_TOKEN: 'token',
    NUKI_SMARTLOCK_ID: '123',
    ACCESS_PIN: PIN,
    ...overrides,
  }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://door.example.com/api/open', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.7', ...headers },
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

describe('clientKey', () => {
  it('uses the IPv4 address and the IPv6 /64 network', () => {
    expect(clientKey('198.51.100.7')).toBe('198.51.100.7')
    expect(clientKey('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64')
    expect(clientKey('2001:DB8:abcd:0012::1')).toBe('2001:db8:abcd:12::/64')
    expect(clientKey('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(clientKey('::ffff:198.51.100.7')).toBe('198.51.100.7')
    expect(clientKey(null)).toBe('unknown')
  })
  it('maps different addresses of one /64 to the same key', () => {
    expect(clientKey('2001:db8:1:2:aaaa::1')).toBe(clientKey('2001:db8:1:2:bbbb:cccc:dddd:eeee'))
  })
})

describe('POST /api/open', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
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

  it('trims whitespace from pasted secrets', async () => {
    fetchMock.mockResolvedValue(nukiOk())
    const res = await worker.fetch(
      post({ pin: PIN }),
      makeEnv({ NUKI_API_TOKEN: 'token\n', NUKI_SMARTLOCK_ID: ' 123 \n', ACCESS_PIN: `${PIN}\n` }),
    )
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://api.nuki.io/smartlock/123/action')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer token')
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

  it('locks a client after 5 wrong PINs, even for the right PIN', async () => {
    const env = makeEnv()
    for (let i = 0; i < 5; i++) expect((await worker.fetch(post({ pin: '000000' }), env)).status).toBe(401)
    const res = await worker.fetch(post({ pin: PIN }), env)
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'locked', retry_after: 60 })
    expect(res.headers.get('retry-after')).toBe('60')
    expect(fetchMock).not.toHaveBeenCalled()

    // A different client is not affected
    fetchMock.mockResolvedValue(nukiOk())
    expect((await worker.fetch(post({ pin: PIN }, { 'cf-connecting-ip': '203.0.113.9' }), env)).status).toBe(200)
  })

  it('treats addresses of one IPv6 /64 as the same client', async () => {
    const env = makeEnv()
    for (let i = 0; i < 5; i++) {
      await worker.fetch(post({ pin: '000000' }, { 'cf-connecting-ip': `2001:db8:1:2::${i + 1}` }), env)
    }
    const res = await worker.fetch(post({ pin: PIN }, { 'cf-connecting-ip': '2001:db8:1:2::99' }), env)
    expect(res.status).toBe(429)
  })

  it('answers with cooldown right after a successful opening', async () => {
    fetchMock.mockResolvedValue(nukiOk())
    const env = makeEnv()
    expect((await worker.fetch(post({ pin: PIN }), env)).status).toBe(200)
    const res = await worker.fetch(post({ pin: PIN }), env)
    expect(res.status).toBe(429)
    expect(await res.json()).toMatchObject({ error: 'cooldown' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed, oversized and non-JSON bodies', async () => {
    expect((await worker.fetch(post('not json'), makeEnv())).status).toBe(400)
    expect((await worker.fetch(post({ pin: 123456 }), makeEnv())).status).toBe(400)
    expect((await worker.fetch(post({ pin: 'x'.repeat(5000) }), makeEnv())).status).toBe(400)
    const form = await worker.fetch(post({ pin: PIN }, { 'content-type': 'application/x-www-form-urlencoded' }), makeEnv())
    expect(form.status).toBe(415)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('limits bodies sent without Content-Length (streamed)', async () => {
    const big = new TextEncoder().encode(JSON.stringify({ pin: 'x'.repeat(10000) }))
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(big)
        c.close()
      },
    })
    const req = new Request('https://door.example.com/api/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    expect(req.headers.get('content-length')).toBeNull()
    expect((await worker.fetch(req, makeEnv())).status).toBe(400)
  })

  it('only allows POST', async () => {
    const res = await worker.fetch(new Request('https://door.example.com/api/open'), makeEnv())
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('POST')
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

  it('fails closed when not configured', async () => {
    const cases: Partial<Env>[] = [
      { NUKI_API_TOKEN: '' },
      { NUKI_SMARTLOCK_ID: '' },
      { ACCESS_PIN: '1234' },
      { NUKI_ACTION: '9' },
      { OPEN_HOURS: 'whenever' },
      { OPEN_HOURS: '07:00-21:00' }, // TIMEZONE missing
      { OPEN_HOURS: '07:00-21:00', TIMEZONE: 'Mars/Base' },
      { GUARD: undefined as unknown as Env['GUARD'] },
    ]
    for (const overrides of cases) {
      expect((await worker.fetch(post({ pin: PIN }), makeEnv(overrides))).status).toBe(503)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts a PIN with exactly the minimum length', async () => {
    fetchMock.mockResolvedValue(nukiOk())
    const res = await worker.fetch(post({ pin: '12345' }), makeEnv({ ACCESS_PIN: '12345' }))
    expect(res.status).toBe(200)
  })

  it('returns 429 when the per-IP rate limiter trips, before checking the PIN', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const res = await worker.fetch(post({ pin: PIN }), makeEnv({ RATE_LIMITER: { limit } as unknown as RateLimit }))
    expect(res.status).toBe(429)
    expect(limit).toHaveBeenCalledWith({ key: '198.51.100.7' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  describe('opening hours', () => {
    const env = (hours: string) => makeEnv({ OPEN_HOURS: hours, TIMEZONE: 'Europe/Berlin' })

    it('refuses outside the hours without checking the PIN', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-07-01T01:30:00Z')) // 03:30 in Berlin (CEST)
      const res = await worker.fetch(post({ pin: PIN }), env('07:00-21:00'))
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'closed', open_hours: '07:00–21:00' })
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('opens within the hours', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-07-01T10:00:00Z')) // 12:00 in Berlin
      fetchMock.mockResolvedValue(nukiOk())
      expect((await worker.fetch(post({ pin: PIN }), env('07:00-21:00'))).status).toBe(200)
    })
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

  it('allows an immediate retry after Nuki failed (no cooldown)', async () => {
    const env = makeEnv()
    fetchMock.mockResolvedValueOnce(new Response('', { status: 400 })).mockResolvedValueOnce(nukiOk())
    expect((await worker.fetch(post({ pin: PIN }), env)).status).toBe(502)
    expect((await worker.fetch(post({ pin: PIN }), env)).status).toBe(200)
  })

  it('does not retry on 401 from Nuki (bad token)', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 401 }))
    const res = await worker.fetch(post({ pin: PIN }), makeEnv())
    expect(res.status).toBe(502)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('Turnstile', () => {
  const fetchMock = vi.fn<typeof fetch>()
  const env = () => makeEnv({ TURNSTILE_SECRET_KEY: 'ts-secret' })
  const siteverify = (success: boolean) => new Response(JSON.stringify({ success }), { headers: { 'content-type': 'application/json' } })

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('verifies the token, then opens', async () => {
    fetchMock.mockResolvedValueOnce(siteverify(true)).mockResolvedValueOnce(nukiOk())
    const res = await worker.fetch(post({ pin: PIN, turnstile: 'tok' }), env())
    expect(res.status).toBe(200)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify')
    const form = init?.body as FormData
    expect(form.get('secret')).toBe('ts-secret')
    expect(form.get('response')).toBe('tok')
    expect(form.get('remoteip')).toBe('198.51.100.7')
  })

  it('refuses a missing or rejected token without counting it as a wrong PIN', async () => {
    expect((await worker.fetch(post({ pin: PIN }), env())).status).toBe(403)
    fetchMock.mockImplementation(async () => siteverify(false))
    const e = env()
    for (let i = 0; i < 6; i++) {
      const res = await worker.fetch(post({ pin: '000000', turnstile: 'bad' }), e)
      expect(await res.json()).toEqual({ error: 'captcha_failed' })
    }
    // Not locked: Turnstile failures never reach the guard
    fetchMock.mockReset()
    fetchMock.mockResolvedValueOnce(siteverify(true)).mockResolvedValueOnce(nukiOk())
    expect((await worker.fetch(post({ pin: PIN, turnstile: 'ok' }), e)).status).toBe(200)
  })

  it('fails closed when Cloudflare cannot be reached', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    const res = await worker.fetch(post({ pin: PIN, turnstile: 'tok' }), env())
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'captcha_unavailable' })
  })

  it('is skipped entirely without a secret', async () => {
    fetchMock.mockResolvedValue(nukiOk())
    expect((await worker.fetch(post({ pin: PIN }), makeEnv())).status).toBe(200)
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
