/**
 * Cloudflare Worker: serves the Vue app (static assets) and exposes one API route,
 * POST /api/open, which checks the PIN and triggers the Nuki Opener via the Nuki Web API.
 */

export interface Env {
  ASSETS: Fetcher
  /** Optional: per-IP rate limiter binding (see wrangler.jsonc). */
  RATE_LIMITER?: RateLimit
  /** Secret: Nuki Web API token. */
  NUKI_API_TOKEN: string
  /** Secret: ID of the Opener, see `npm run smartlocks`. */
  NUKI_SMARTLOCK_ID: string
  /** Secret: shared PIN, at least MIN_PIN_LENGTH characters. */
  ACCESS_PIN: string
  /** Optional var: Nuki action number. Default 3 = Opener buzzer (also "unlatch" on a Smart Lock). */
  NUKI_ACTION?: string
}

const NUKI_API = 'https://api.nuki.io'
const DEFAULT_NUKI_ACTION = 3
const MIN_PIN_LENGTH = 6
const MAX_BODY_BYTES = 1024
const NUKI_ATTEMPTS = 3
const NUKI_TIMEOUT_MS = 6000

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

/** Constant-time PIN comparison: hash both sides to equal length, then XOR-accumulate. */
export async function pinMatches(given: string, expected: string): Promise<boolean> {
  const a = await sha256(given)
  const b = await sha256(expected)
  let diff = a.length ^ b.length
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

function resolveAction(env: Env): number | null {
  if (env.NUKI_ACTION === undefined || env.NUKI_ACTION === '') return DEFAULT_NUKI_ACTION
  const n = Number(env.NUKI_ACTION)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

function isConfigured(env: Env): boolean {
  return Boolean(
    env.NUKI_API_TOKEN &&
      env.NUKI_SMARTLOCK_ID &&
      env.ACCESS_PIN &&
      env.ACCESS_PIN.length >= MIN_PIN_LENGTH &&
      resolveAction(env) !== null,
  )
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Sends the action to the Nuki Web API. Retries on network errors, 429 and 5xx. */
async function triggerNuki(env: Env, action: number): Promise<boolean> {
  const url = `${NUKI_API}/smartlock/${encodeURIComponent(env.NUKI_SMARTLOCK_ID)}/action`
  for (let attempt = 1; attempt <= NUKI_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.NUKI_API_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ action }),
        signal: AbortSignal.timeout(NUKI_TIMEOUT_MS),
      })
      if (res.ok) return true
      if (res.status !== 429 && res.status < 500) {
        // 401/403: token or scopes wrong. 404: wrong smartlock ID. Retrying will not help.
        console.error(`Nuki API rejected the request: HTTP ${res.status}`)
        return false
      }
      console.error(`Nuki API error: HTTP ${res.status} (attempt ${attempt}/${NUKI_ATTEMPTS})`)
    } catch (err) {
      console.error(`Nuki API unreachable (attempt ${attempt}/${NUKI_ATTEMPTS}):`, String(err))
    }
    if (attempt < NUKI_ATTEMPTS) await sleep(400 * attempt)
  }
  return false
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin === null) return true // non-browser clients; the PIN is the real protection
  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false // e.g. "Origin: null"
  }
}

async function readPin(request: Request): Promise<string | null> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) return null
  try {
    const body: unknown = await request.json()
    if (typeof body === 'object' && body !== null && 'pin' in body && typeof body.pin === 'string') {
      return body.pin.trim().slice(0, 128)
    }
  } catch {
    /* invalid JSON */
  }
  return null
}

async function handleOpen(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403)

  if (!isConfigured(env)) {
    console.error(
      `Worker is not configured: set NUKI_API_TOKEN, NUKI_SMARTLOCK_ID and ACCESS_PIN (>= ${MIN_PIN_LENGTH} chars); NUKI_ACTION must be 1-5.`,
    )
    return json({ error: 'not_configured' }, 503)
  }

  if (env.RATE_LIMITER) {
    const key = request.headers.get('cf-connecting-ip') ?? 'unknown'
    const { success } = await env.RATE_LIMITER.limit({ key })
    if (!success) return json({ error: 'rate_limited' }, 429)
  }

  const pin = await readPin(request)
  if (pin === null) return json({ error: 'bad_request' }, 400)
  if (!(await pinMatches(pin, env.ACCESS_PIN))) return json({ error: 'wrong_pin' }, 401)

  const ok = await triggerNuki(env, resolveAction(env)!)
  return ok ? json({ ok: true }) : json({ error: 'nuki_unreachable' }, 502)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/open') return handleOpen(request, env)
    if (pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
