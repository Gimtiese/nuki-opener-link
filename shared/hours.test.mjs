import { describe, expect, it } from 'vitest'
import { formatOpenHours, isOpenAt, isValidTimeZone, minutesInZone, parseOpenHours, serializeOpenHours } from './hours.js'

const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

describe('parseOpenHours', () => {
  it('treats empty input as always open', () => {
    expect(parseOpenHours('')).toEqual([])
    expect(parseOpenHours(undefined)).toEqual([])
  })
  it('parses single, multiple and overnight ranges', () => {
    expect(parseOpenHours('07:00-21:00')).toEqual([{ from: 420, to: 1260 }])
    expect(parseOpenHours(' 7:00 - 12:00 , 14:30-24:00 ')).toEqual([
      { from: 420, to: 720 },
      { from: 870, to: 1440 },
    ])
    expect(parseOpenHours('22:00-06:00')).toEqual([{ from: 1320, to: 360 }])
  })
  it('rejects invalid input', () => {
    for (const bad of ['7-21', '25:00-26:00', '07:60-08:00', '24:30-01:00', '08:00-08:00', '08:00', 'abc', '07:00-21:00,']) {
      expect(parseOpenHours(bad)).toBeNull()
    }
  })
})

describe('isOpenAt', () => {
  it('handles normal and overnight ranges', () => {
    const day = parseOpenHours('07:00-21:00')
    expect(isOpenAt(day, at('06:59'))).toBe(false)
    expect(isOpenAt(day, at('07:00'))).toBe(true)
    expect(isOpenAt(day, at('20:59'))).toBe(true)
    expect(isOpenAt(day, at('21:00'))).toBe(false)
    const night = parseOpenHours('22:00-06:00')
    expect(isOpenAt(night, at('23:00'))).toBe(true)
    expect(isOpenAt(night, at('05:59'))).toBe(true)
    expect(isOpenAt(night, at('12:00'))).toBe(false)
    expect(isOpenAt([], at('03:00'))).toBe(true)
  })
})

describe('time zones', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true)
    expect(isValidTimeZone('Mars/Olympus')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })
  it('converts to local minutes including daylight saving time', () => {
    expect(minutesInZone(new Date('2026-07-01T10:15:00Z'), 'Europe/Berlin')).toBe(at('12:15')) // CEST
    expect(minutesInZone(new Date('2026-01-01T10:15:00Z'), 'Europe/Berlin')).toBe(at('11:15')) // CET
    expect(minutesInZone(new Date('2026-01-01T23:30:00Z'), 'UTC')).toBe(at('23:30'))
  })
})

it('formats ranges for display', () => {
  expect(formatOpenHours(parseOpenHours('07:00-12:00,14:00-24:00'))).toBe('07:00–12:00, 14:00–24:00')
})

it('serializes ranges to the canonical config form', () => {
  expect(serializeOpenHours(parseOpenHours(' 7:00 - 12:00 , 14:30-24:00 '))).toBe('07:00-12:00,14:30-24:00')
})
