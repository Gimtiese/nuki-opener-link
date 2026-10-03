import { describe, expect, it, vi } from 'vitest'
import { parseContacts } from './config'
import { detectLocale, resolveLocale } from './i18n'

describe('parseContacts', () => {
  it('parses valid entries and builds tel: links', () => {
    expect(parseContacts('[{"label":"Anna","phone":"+49 160 1234567"},{"phone":"0160 555 66 77"}]')).toEqual([
      { label: 'Anna', phone: '+49 160 1234567', href: 'tel:+491601234567' },
      { label: undefined, phone: '0160 555 66 77', href: 'tel:01605556677' },
    ])
  })

  it('ignores missing, invalid or malformed input', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(parseContacts(undefined)).toEqual([])
    expect(parseContacts('')).toEqual([])
    expect(parseContacts('not json')).toEqual([])
    expect(parseContacts('{"phone":"123"}')).toEqual([])
    expect(parseContacts('[{"phone":"abc"},{"label":"x"},null,"str"]')).toEqual([])
  })

  it('does not allow script-like phone values', () => {
    expect(parseContacts('[{"phone":"javascript:alert(1)"}]')).toEqual([])
  })
})

describe('locale', () => {
  it('detects supported languages and falls back to English', () => {
    expect(detectLocale(['de-DE', 'en'])).toBe('de')
    expect(detectLocale(['fr-FR', 'en-US'])).toBe('en')
    expect(detectLocale(['fr', 'es'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })

  it('lets VITE_LOCALE override detection', () => {
    expect(resolveLocale('de', ['en'])).toBe('de')
    expect(resolveLocale('auto', ['de'])).toBe('de')
    expect(resolveLocale(undefined, ['en'])).toBe('en')
  })
})
