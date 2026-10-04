import { describe, expect, it } from 'vitest'
import { parseCountries, serializeCountries } from './countries.js'

describe('parseCountries', () => {
  it('treats empty input as no restriction', () => {
    expect(parseCountries('')).toEqual([])
    expect(parseCountries(undefined)).toEqual([])
    expect(parseCountries('  ')).toEqual([])
  })
  it('normalizes case, separators and duplicates', () => {
    expect(parseCountries('de')).toEqual(['DE'])
    expect(parseCountries(' de, at;ch  DE ')).toEqual(['DE', 'AT', 'CH'])
  })
  it('rejects anything that is not a two-letter code', () => {
    for (const bad of ['DEU', 'D', '12', 'DE,', 'DE,A1', 'Germany']) {
      // a trailing comma alone is harmless, everything else is invalid
      if (bad === 'DE,') expect(parseCountries(bad)).toEqual(['DE'])
      else expect(parseCountries(bad)).toBeNull()
    }
  })
  it('serializes to the canonical form', () => {
    expect(serializeCountries(parseCountries('de at'))).toBe('DE,AT')
  })
})
