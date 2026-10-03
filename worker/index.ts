/**
 * Cloudflare Worker: serves the Vue app (static assets) and exposes one API route,
 * POST /api/open, which checks the PIN and triggers the Nuki Opener via the Nuki Web API.
 *
 * Order of checks for POST /api/open:
 *   method → origin → configuration → per-IP rate limit → JSON body → opening hours
 *   → Turnstile (if enabled) → PIN + global brute-force guard (Durable Object) → Nuki API
 */

import { formatOpenHours, isOpenAt, isValidTimeZone, minutesInZone, parseOpenHours } from '../shared/hours.js'
import type { Guard } from './guard'

export { Guard } from './guard'

export interface Env {
  ASSETS: Fetcher
  /** Global brute-force guard (Durable Object, see wrangler.jsonc). */
  GUARD: DurableObjectNamespace<Guard>
  /** Optional: cheap per-IP flood protection in front of the guard (see wrangler.jsonc). */
  RATE_LIMITER?: RateLimit
  /** Secret: Nuki Web API token. */
  NUKI_API_TOKEN: string
  /** Secret: ID of the Opener, see `npm run smartlocks`. */
  NUKI_SMARTLOCK_ID: string
  /** Secret: shared PIN, at least MIN_PIN_LENGTH characters. */
  ACCESS_PIN: string
  /** Optional var: Nuki action number. Default 3 = Opener buzzer (also "unlatch" on a Smart Lock). */
  NUKI_ACTION?: string
  /** Optional var: opening hours, e.g. "07:00-21:00" or "07:00-12:00,14:00-21:00". Empty = always. */
  OPEN_HOURS?: string
  /** Var, required with OPEN_HOURS: IANA time zone, e.g. "Europe/Berlin". */
  TIMEZONE?: string
  /** Optional secret: Cloudflare Turnstile secret key. When set, every attempt needs a valid Turnstile token. */
  TURNSTILE_SECRET_KEY?: string
}

const NUKI_API = 'https://api.nuki.io'
const DEFAULT_NUKI_ACTION = 3
const MIN_PIN_LENGTH = 5
const MAX_BODY_BYTES = 4096 // a Turnstile token can be up to 2048 characters
const NUKI_ATTEMPTS = 3
const NUKI_TIMEOUT_MS = 6000
const RATE_LIMIT_PERIOD_S = 60
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      ...headers,
    },
  })

const tooMany = (error: string, retryAfter: number) =>
  json({ error, retry_after: retryAfter }, 429, { 'retry-after': String(retryAfter) })

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

/**
 * Key that identifies one client for rate limiting. IPv4: the address. IPv6: the /64 network,
 * because a single connection usually controls a whole /64 and could otherwise rotate addresses.
 */
export function clientKey(ip: string | null): string {
  if (!ip) return 'unknown'
  if (!ip.includes(':')) return ip
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1) // IPv4-mapped IPv6
  const [head = '', tail = ''] = ip.toLowerCase().split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = ip.includes('::') ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`
}

function resolveAction(env: Env): number | null {
  if (env.NUKI_ACTION === undefined || env.NUKI_ACTION === '') return DEFAULT_NUKI_ACTION
  const n = Number(env.NUKI_ACTION)
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null
}

/** Secrets are often pasted with a trailing newline or space; strip that so it cannot break auth or URLs. */
function cleanEnv(env: Env): Env {
  return {
    ...env,
    NUKI_API_TOKEN: env.NUKI_API_TOKEN?.trim() ?? '',
    NUKI_SMARTLOCK_ID: env.NUKI_SMARTLOCK_ID?.trim() ?? '',
    ACCESS_PIN: env.ACCESS_PIN?.trim() ?? '',
    OPEN_HOURS: env.OPEN_HOURS?.trim() ?? '',
    TIMEZONE: env.TIMEZONE?.trim() ?? '',
    TURNSTILE_SECRET_KEY: env.TURNSTILE_SECRET_KEY?.trim() ?? '',
  }
}

/** Returns a description of the first configuration problem, or null if everything is fine. */
function configProblem(env: Env): string | null {
  if (!env.GUARD) return 'the GUARD Durable Object binding is missing (see wrangler.jsonc)'
  if (!env.NUKI_API_TOKEN) return 'secret NUKI_API_TOKEN is not set'
  if (!env.NUKI_SMARTLOCK_ID) return 'secret NUKI_SMARTLOCK_ID is not set'
  if (!env.ACCESS_PIN) return 'secret ACCESS_PIN is not set'
  if (env.ACCESS_PIN.length < MIN_PIN_LENGTH) return `ACCESS_PIN must have at least ${MIN_PIN_LENGTH} characters`
  if (resolveAction(env) === null) return 'NUKI_ACTION must be a number from 1 to 5'
  if (parseOpenHours(env.OPEN_HOURS) === null) return `OPEN_HOURS "${env.OPEN_HOURS}" is invalid, expected e.g. "07:00-21:00"`
  if (env.OPEN_HOURS && !isValidTimeZone(env.TIMEZONE)) return 'TIMEZONE must be a valid IANA time zone (e.g. "Europe/Berlin") when OPEN_HOURS is set'
  return null
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
        // 400: bad parameter (usually a wrong smartlock ID). 401/403: token or scopes wrong. Retrying will not help.
        const detail = (await res.text().catch(() => '')).slice(0, 200)
        console.error(`Nuki API rejected the request: HTTP ${res.status} ${detail}`.trim())
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

/** Reads at most MAX_BODY_BYTES, also when no Content-Length header is sent. Null if larger. */
async function readLimitedText(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

interface OpenRequest {
  pin: string
  turnstile: string
}

async function readOpenRequest(request: Request): Promise<OpenRequest | null> {
  const text = await readLimitedText(request)
  if (text === null) return null
  try {
    const body: unknown = JSON.parse(text)
    if (typeof body !== 'object' || body === null || !('pin' in body) || typeof body.pin !== 'string') return null
    const turnstile = 'turnstile' in body && typeof body.turnstile === 'string' ? body.turnstile : ''
    return { pin: body.pin.trim().slice(0, 128), turnstile }
  } catch {
    return null // invalid JSON
  }
}

/** Verifies a Turnstile token with Cloudflare. Null if Cloudflare could not be asked (fail closed). */
async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean | null> {
  if (!token) return false
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  if (ip) form.append('remoteip', ip)
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success !== true) console.warn(`Turnstile rejected: ${(data['error-codes'] ?? []).join(', ') || 'unknown'}`)
    return data.success === true
  } catch (err) {
    console.error('Turnstile verification unavailable:', String(err))
    return null
  }
}

async function handleOpen(request: Request, rawEnv: Env): Promise<Response> {
  const env = cleanEnv(rawEnv)
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST' })
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403)

  const problem = configProblem(env)
  if (problem) {
    console.error(`Not configured: ${problem}.`)
    return json({ error: 'not_configured' }, 503)
  }

  const ip = request.headers.get('cf-connecting-ip')
  const client = clientKey(ip)
  if (env.RATE_LIMITER && !(await env.RATE_LIMITER.limit({ key: client })).success) {
    return tooMany('rate_limited', RATE_LIMIT_PERIOD_S)
  }

  // Requiring JSON forces a CORS preflight for cross-site requests, which this API never answers.
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json({ error: 'unsupported_media_type' }, 415)
  }
  const body = await readOpenRequest(request)
  if (body === null) return json({ error: 'bad_request' }, 400)

  const hours = parseOpenHours(env.OPEN_HOURS) ?? []
  if (!isOpenAt(hours, minutesInZone(new Date(), env.TIMEZONE || 'UTC'))) {
    return json({ error: 'closed', open_hours: formatOpenHours(hours) }, 403)
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const human = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, body.turnstile, ip)
    if (human === null) return json({ error: 'captcha_unavailable' }, 503)
    if (!human) return json({ error: 'captcha_failed' }, 403)
  }

  const pinOk = await pinMatches(body.pin, env.ACCESS_PIN)
  const guard = env.GUARD.get(env.GUARD.idFromName('global'))
  const decision = await guard.attempt(client, pinOk)
  switch (decision.result) {
    case 'locked':
      return tooMany('locked', decision.retryAfter)
    case 'cooldown':
      return tooMany('cooldown', decision.retryAfter)
    case 'wrong_pin':
      return json({ error: 'wrong_pin' }, 401)
  }

  if (!(await triggerNuki(env, resolveAction(env)!))) return json({ error: 'nuki_unreachable' }, 502)
  await guard.opened()
  return json({ ok: true })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname === '/api/open') return handleOpen(request, env)
    if (pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404)
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
