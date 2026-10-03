// Cloudflare Turnstile, loaded only when VITE_TURNSTILE_SITE_KEY is set.
// The widget stays invisible unless Cloudflare needs an interaction ("interaction-only").

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string
  reset(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

function loadScript(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')))
    script.onerror = () => reject(new Error('Turnstile could not be loaded'))
    document.head.appendChild(script)
  })
}

export interface Turnstile {
  /** Resolves with a fresh token, or null if none arrives in time. */
  token(timeoutMs?: number): Promise<string | null>
  /** Discards the used token and requests a new one (tokens are single-use). */
  reset(): void
}

export function createTurnstile(siteKey: string, container: HTMLElement, language: string): Turnstile {
  let current: string | null = null
  let widgetId: string | null = null
  let failed = false
  let waiters: ((token: string | null) => void)[] = []

  const deliver = (token: string | null) => {
    current = token
    waiters.forEach((w) => w(token))
    waiters = []
  }

  loadScript()
    .then((api) => {
      widgetId = api.render(container, {
        sitekey: siteKey,
        action: 'open',
        appearance: 'interaction-only',
        language,
        callback: (token: string) => deliver(token),
        'expired-callback': () => (current = null),
      })
    })
    .catch(() => {
      failed = true
      deliver(null)
    })

  return {
    token(timeoutMs = 20000) {
      if (current) return Promise.resolve(current)
      if (failed) return Promise.resolve(null)
      return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), timeoutMs)
        waiters.push((token) => {
          clearTimeout(timer)
          resolve(token)
        })
      })
    },
    reset() {
      current = null
      if (widgetId && window.turnstile) window.turnstile.reset(widgetId)
    },
  }
}
