export type OpenResult = 'ok' | 'wrong_pin' | 'rate_limited' | 'error'

const REQUEST_TIMEOUT_MS = 20000

export async function openDoor(pin: string): Promise<OpenResult> {
  // AbortSignal.timeout() is not available on older phones, so use a plain AbortController.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch('/api/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin }),
      signal: controller.signal,
    })
    if (res.ok) return 'ok'
    if (res.status === 401) return 'wrong_pin'
    if (res.status === 429) return 'rate_limited'
    return 'error'
  } catch {
    return 'error'
  } finally {
    clearTimeout(timer)
  }
}
