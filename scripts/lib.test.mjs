import { describe, expect, it } from 'vitest'
import {
  contactsToEnv,
  generatePin,
  getCustomDomain,
  isValidPin,
  normalizeDomain,
  normalizePhone,
  parseDotenv,
  setCustomDomain,
  updateDotenv,
} from './lib.mjs'

describe('generatePin / isValidPin', () => {
  it('generates digit-only PINs of the requested length', () => {
    expect(generatePin()).toMatch(/^\d{8}$/)
    expect(generatePin(6)).toMatch(/^\d{6}$/)
  })
  it('requires at least 5 characters', () => {
    expect(isValidPin('1234')).toBe(false)
    expect(isValidPin('12345')).toBe(true)
    expect(isValidPin('   ')).toBe(false)
  })
})

describe('normalizeDomain', () => {
  it('accepts hostnames and strips scheme, path and case', () => {
    expect(normalizeDomain('door.example.com')).toBe('door.example.com')
    expect(normalizeDomain(' https://Door.Example.com/some/path ')).toBe('door.example.com')
  })
  it('rejects things that are not hostnames', () => {
    for (const bad of ['', 'localhost', 'not a host', 'a..b.com', '-x.example.com', 'example', '1.2.3.4']) {
      expect(normalizeDomain(bad)).toBeNull()
    }
  })
})

describe('normalizePhone', () => {
  it('accepts phone numbers and rejects others', () => {
    expect(normalizePhone('+49 160 1234567')).toBe('+49 160 1234567')
    expect(normalizePhone('0160/1234567')).toBe('0160/1234567')
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('javascript:1')).toBeNull()
    expect(normalizePhone('12')).toBeNull()
  })
})

describe('dotenv helpers', () => {
  it('parses plain and quoted values', () => {
    expect(parseDotenv(`# c\nA=1\nB='{"x":1}'\nC="hi"\n`)).toEqual({ A: '1', B: '{"x":1}', C: 'hi' })
  })
  it('updates, appends and removes keys while keeping other lines', () => {
    const out = updateDotenv('# keep\nA=1\nB=2\n', { A: '9', C: '3', B: null })
    expect(out).toBe('# keep\nA=9\nC=3\n')
    expect(updateDotenv('', { A: '1' })).toBe('A=1\n')
    expect(updateDotenv('A=1\n', { A: null })).toBe('')
  })
  it('round-trips contacts, including apostrophes', () => {
    const contacts = [{ label: "O'Brien", phone: '+49 160 1234567' }]
    const env = contactsToEnv(contacts)
    expect(env?.startsWith("'") && env.endsWith("'")).toBe(true)
    expect(JSON.parse(parseDotenv(`VITE_CONTACTS=${env}`).VITE_CONTACTS ?? '')).toEqual(contacts)
    expect(contactsToEnv([])).toBeNull()
  })
})

describe('custom domain in wrangler.jsonc', () => {
  const file = [
    '{',
    '  // --- custom domain (managed by `npm run setup`) ---',
    '  // "routes": [{ "pattern": "door.example.com", "custom_domain": true }],',
    '  // --- end custom domain ---',
    '  "name": "x"',
    '}',
  ].join('\n')

  it('has no domain by default', () => {
    expect(getCustomDomain(file)).toBeNull()
  })
  it('sets, reads and clears the domain', () => {
    const withDomain = setCustomDomain(file, 'haus.example.org')
    expect(getCustomDomain(withDomain)).toBe('haus.example.org')
    expect(withDomain).toContain('"name": "x"')
    const cleared = setCustomDomain(withDomain, null)
    expect(getCustomDomain(cleared)).toBeNull()
    expect(cleared).toBe(file)
  })
  it('returns null when the markers are missing', () => {
    expect(setCustomDomain('{ "name": "x" }', 'a.example.com')).toBeNull()
  })
})
