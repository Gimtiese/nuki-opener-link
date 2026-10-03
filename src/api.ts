export type OpenResult =
  | { status: 'ok' }
  | { status: 'wrong_pin' }
  | { status: 'locked'; retryAfter: number }
  | { status: 'cooldown'; retryAfter: number }
  | { status: 'rate_limited'; retryAfter: number }
  | { status: 'closed'; openHours: string }
  | { status: 'captcha_failed' }
  | { status: 'error' }

const REQUEST_TIMEOUT_MS = 20000

interface ErrorBody {
  error?: string
  retry_after?: number
  open_hours?: string
}

export async function openDoor(pin: string, turnstile?: string): Promise<OpenResult> {
  // AbortSignal.timeout() is not available on older phones, so use a plain AbortController.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch('/api/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin, turnstile }),
      signal: controller.signal,
    })
    if (res.ok) return { status: 'ok' }
    const body = (await res.json().catch(() => ({}))) as ErrorBody
    const retryAfter = Number(body.retry_after) || 60
    switch (body.error) {
      case 'wrong_pin':
        return { status: 'wrong_pin' }
      case 'locked':
        return { status: 'locked', retryAfter }
      case 'cooldown':
        return { status: 'cooldown', retryAfter }
      case 'rate_limited':
        return { status: 'rate_limited', retryAfter }
      case 'closed':
        return { status: 'closed', openHours: body.open_hours ?? '' }
      case 'captcha_failed':
        return { status: 'captcha_failed' }
      default:
        return { status: 'error' }
    }
  } catch {
    return { status: 'error' }
  } finally {
    clearTimeout(timer)
  }
}
