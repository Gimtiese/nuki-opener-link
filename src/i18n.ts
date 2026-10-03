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
  rateLimited: string
  failed: string
  changePin: string
  problems: string
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
    rateLimited: 'Too many attempts. Please wait a moment and try again.',
    failed: 'The door could not be opened right now. Please try again or call.',
    changePin: 'Change PIN',
    problems: 'Not working? Please call:',
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
    rateLimited: 'Zu viele Versuche. Bitte kurz warten und erneut probieren.',
    failed: 'Die Tür konnte gerade nicht geöffnet werden. Bitte noch einmal versuchen oder anrufen.',
    changePin: 'PIN ändern',
    problems: 'Klappt etwas nicht? Bitte anrufen:',
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
