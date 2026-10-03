/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Page title / heading. Defaults to a localized "Front door". */
  readonly VITE_SITE_TITLE?: string
  /** JSON array of {"label"?: string, "phone": string}. */
  readonly VITE_CONTACTS?: string
  /** "auto" (default), "en" or "de". */
  readonly VITE_LOCALE?: string
  /** Cloudflare Turnstile site key. Empty = no Turnstile. */
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}
