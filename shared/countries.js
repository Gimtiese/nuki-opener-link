// Allowed countries, shared by the Worker (enforcement) and the setup script (validation).
// Format: ISO 3166-1 alpha-2 codes separated by commas or spaces, e.g. "DE,AT,CH". Empty = no restriction.

/**
 * @param {string | undefined} text
 * @returns {string[] | null} upper-case, de-duplicated codes ([] = no restriction); null if invalid
 */
export function parseCountries(text) {
  const value = (text ?? '').trim()
  if (!value) return []
  const codes = value.toUpperCase().split(/[\s,;]+/).filter(Boolean)
  if (!codes.every((code) => /^[A-Z]{2}$/.test(code))) return null
  return [...new Set(codes)]
}

/** Canonical config form, e.g. "DE,AT,CH". @param {string[]} codes */
export const serializeCountries = (codes) => codes.join(',')
