export interface Contact {
  label?: string
  /** Shown as written. */
  phone: string
  /** `tel:` URI with everything but digits and a leading + removed. */
  href: string
}

export const PIN_STORAGE_KEY = 'door.pin'

/** Parses the JSON from VITE_CONTACTS; invalid or missing input yields no contacts. */
export function parseContacts(raw: string | undefined): Contact[] {
  if (!raw?.trim()) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    console.warn('VITE_CONTACTS is not valid JSON and is ignored.')
    return []
  }
  if (!Array.isArray(data)) return []

  const contacts: Contact[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null || !('phone' in entry)) continue
    const phone = typeof entry.phone === 'string' ? entry.phone.trim() : ''
    const number = phone.replace(/[^\d+]/g, '')
    if (!/^\+?\d{3,}$/.test(number)) continue
    const label = 'label' in entry && typeof entry.label === 'string' ? entry.label.trim() : ''
    contacts.push({ label: label || undefined, phone, href: `tel:${number}` })
  }
  return contacts
}

export const siteTitle: string | undefined = import.meta.env.VITE_SITE_TITLE?.trim() || undefined
export const contacts: Contact[] = parseContacts(import.meta.env.VITE_CONTACTS)

export const turnstileSiteKey: string | undefined = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || undefined
