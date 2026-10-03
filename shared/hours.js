// Opening hours, shared by the Worker (enforcement) and the setup script (validation).
// Format: "HH:MM-HH:MM", several ranges separated by commas, e.g. "07:00-12:00,14:00-21:00".
// A range may cross midnight ("22:00-06:00"); "24:00" is allowed as an end time.

/** @typedef {{ from: number, to: number }} TimeRange  Minutes since midnight, `to` exclusive. */

const pad = (n) => String(n).padStart(2, '0')
const formatMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`

/**
 * Parses opening hours. Empty input means "always open" and returns [].
 * @param {string | undefined} text
 * @returns {TimeRange[] | null} null if the text is invalid
 */
export function parseOpenHours(text) {
  const value = (text ?? '').trim()
  if (!value) return []
  /** @type {TimeRange[]} */
  const ranges = []
  for (const part of value.split(',')) {
    const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/)
    if (!m) return null
    const [h1, m1, h2, m2] = m.slice(1).map(Number)
    if (h1 > 23 || m1 > 59 || h2 > 24 || m2 > 59 || (h2 === 24 && m2 !== 0)) return null
    const from = h1 * 60 + m1
    const to = h2 * 60 + m2
    if (from === to) return null
    ranges.push({ from, to })
  }
  return ranges
}

/**
 * @param {TimeRange[]} ranges
 * @param {number} minute minutes since midnight
 */
export function isOpenAt(ranges, minute) {
  if (!ranges.length) return true
  return ranges.some(({ from, to }) => (from < to ? minute >= from && minute < to : minute >= from || minute < to))
}

/** @param {TimeRange[]} ranges  e.g. "07:00–12:00, 14:00–21:00" */
export function formatOpenHours(ranges) {
  return ranges.map(({ from, to }) => `${formatMinutes(from)}–${formatMinutes(to)}`).join(', ')
}

/** @param {string | undefined} timeZone */
export function isValidTimeZone(timeZone) {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone })
    return true
  } catch {
    return false
  }
}

/**
 * Minutes since midnight of `date` in the given IANA time zone (handles daylight saving time).
 * @param {Date} date
 * @param {string} timeZone
 */
export function minutesInZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const get = (/** @type {string} */ type) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return get('hour') * 60 + get('minute')
}

/** @param {TimeRange[]} ranges  canonical config form, e.g. "07:00-12:00,14:00-21:00" */
export function serializeOpenHours(ranges) {
  return ranges.map(({ from, to }) => `${formatMinutes(from)}-${formatMinutes(to)}`).join(',')
}
