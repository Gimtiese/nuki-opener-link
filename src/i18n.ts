export type Locale = 'en' | 'de'

export interface Messages {
  title: string
  lead: string
  pin: string
  pinPlaceholder: string
  open: string
  opening: string
  opened: string
  success: string
  wrongPin: string
  /** {time} = e.g. "5 minutes" */
  locked: string
  cooldown: string
  /** {time} */
  rateLimited: string
  /** {hours} = e.g. "07:00–21:00" */
  closed: string
  captchaFailed: string
  countryBlocked: string
  failed: string
  changePin: string
  problems: string
  sourceCode: string
  seconds: (n: number) => string
  minutes: (n: number) => string
}

const messages: Record<Locale, Messages> = {
  en: {
    title: 'Front door',
    lead: 'Delivery or visitor? Tap the button and the door will buzz open.',
    pin: 'PIN',
    pinPlaceholder: 'Enter PIN',
    open: 'Open door',
    opening: 'Opening…',
    opened: '✓ Opened',
    success: 'Buzzer activated – please push the door open.',
    wrongPin: 'That PIN is not correct.',
    locked: 'Too many wrong attempts. Please try again in {time} or call.',
    cooldown: 'The door was just opened. Please wait a few seconds.',
    rateLimited: 'Too many attempts. Please try again in {time}.',
    closed: 'The door can only be opened at these times: {hours}.',
    captchaFailed: 'The security check failed. Please try again.',
    countryBlocked: 'The door cannot be opened from your location. Please call.',
    failed: 'The door could not be opened right now. Please try again or call.',
    changePin: 'Change PIN',
    problems: 'Not working? Please call:',
    sourceCode: 'Open source on GitHub',
    seconds: (n) => (n === 1 ? '1 second' : `${n} seconds`),
    minutes: (n) => (n === 1 ? '1 minute' : `${n} minutes`),
  },
  de: {
    title: 'Haustür',
    lead: 'Lieferdienst oder Besuch? Hier tippen, dann öffnet sich die Haustür.',
    pin: 'PIN',
    pinPlaceholder: 'PIN eingeben',
    open: 'Tür öffnen',
    opening: 'Öffne …',
    opened: '✓ Geöffnet',
    success: 'Summer betätigt – bitte die Tür aufdrücken.',
    wrongPin: 'Der PIN ist nicht korrekt.',
    locked: 'Zu viele Fehlversuche. Bitte in {time} erneut versuchen oder anrufen.',
    cooldown: 'Die Tür wurde gerade geöffnet. Bitte ein paar Sekunden warten.',
    rateLimited: 'Zu viele Versuche. Bitte in {time} erneut versuchen.',
    closed: 'Die Tür lässt sich nur zu diesen Zeiten öffnen: {hours}.',
    captchaFailed: 'Die Sicherheitsprüfung ist fehlgeschlagen. Bitte noch einmal versuchen.',
    countryBlocked: 'Von deinem Standort aus lässt sich die Tür nicht öffnen. Bitte anrufen.',
    failed: 'Die Tür konnte gerade nicht geöffnet werden. Bitte noch einmal versuchen oder anrufen.',
    changePin: 'PIN ändern',
    problems: 'Klappt etwas nicht? Bitte anrufen:',
    sourceCode: 'Open Source auf GitHub',
    seconds: (n) => (n === 1 ? '1 Sekunde' : `${n} Sekunden`),
    minutes: (n) => (n === 1 ? '1 Minute' : `${n} Minuten`),
  },
}

/** Picks the first supported language from a browser language list; falls back to English. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const lang of languages) {
    const base = lang.toLowerCase().split('-')[0]
    if (base === 'de' || base === 'en') return base
  }
  return 'en'
}

export function resolveLocale(setting: string | undefined, languages: readonly string[]): Locale {
  return setting === 'de' || setting === 'en' ? setting : detectLocale(languages)
}

export function getMessages(locale: Locale): Messages {
  return messages[locale]
}

/** "45 seconds", "3 minutes" (rounded up). */
export function formatDuration(t: Messages, seconds: number): string {
  return seconds < 60 ? t.seconds(Math.max(1, Math.ceil(seconds))) : t.minutes(Math.ceil(seconds / 60))
}

/** Replaces {name} placeholders. */
export const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
