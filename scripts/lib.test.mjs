import { describe, expect, it } from 'vitest'
import {
  contactsToEnv,
  generatePin,
  isValidPin,
  normalizeDomain,
  normalizePhone,
  parseDotenv,
  readManaged,
  updateDotenv,
  workerName,
  writeManaged,
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

describe('managed block in wrangler.jsonc', () => {
  const file = [
    '{',
    '  // --- managed by `npm run setup` ---',
    '  // "routes": [{ "pattern": "door.example.com", "custom_domain": true }],',
    '  // "vars": { "OPEN_HOURS": "06:00-22:00", "TIMEZONE": "Europe/Berlin" },',
    '  // --- end managed by `npm run setup` ---',
    '  "name": "x"',
    '}',
  ].join('\n')

  it('reads nothing from the commented defaults', () => {
    expect(readManaged(file)).toEqual({ domain: null, vars: {} })
  })

  it('writes and reads domain and vars, and turns off workers.dev with a domain', () => {
    const out = writeManaged(file, { domain: 'haus.example.org', vars: { OPEN_HOURS: '07:00-21:00', TIMEZONE: 'Europe/Berlin' } })
    expect(out).toContain('"workers_dev": false,')
    expect(out).toContain('"preview_urls": false,')
    expect(out).toContain('"name": "x"')
    expect(readManaged(out)).toEqual({ domain: 'haus.example.org', vars: { OPEN_HOURS: '07:00-21:00', TIMEZONE: 'Europe/Berlin' } })
  })

  it('restores the commented defaults when everything is cleared', () => {
    const out = writeManaged(file, { domain: 'a.example.com', vars: { NUKI_ACTION: '3' } })
    expect(writeManaged(out, { domain: null, vars: {} })).toBe(file)
  })

  it('upgrades the marker format of older versions', () => {
    const old = [
      '{',
      '  // --- custom domain (managed by `npm run setup`) ---',
      '  "routes": [{ "pattern": "old.example.com", "custom_domain": true }],',
      '  // --- end custom domain ---',
      '}',
    ].join('\n')
    expect(readManaged(old)?.domain).toBe('old.example.com')
    const out = writeManaged(old, { domain: 'old.example.com', vars: {} })
    expect(out).toContain('// --- managed by `npm run setup` ---')
    expect(readManaged(out)?.domain).toBe('old.example.com')
  })

  it('returns null when the block is missing', () => {
    expect(readManaged('{ "name": "x" }')).toBeNull()
    expect(writeManaged('{ "name": "x" }', { domain: null, vars: {} })).toBeNull()
  })
})

it('reads the worker name from wrangler.jsonc', () => {
  expect(workerName('{\n  "name": "my-door",\n  "main": "x"\n}')).toBe('my-door')
  expect(workerName('{}')).toBe('nuki-opener-link')
})
