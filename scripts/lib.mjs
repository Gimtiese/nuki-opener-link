// Shared helpers for the helper scripts (setup, list-smartlocks). No dependencies.

import { randomInt } from 'node:crypto'
import readline from 'node:readline'

export const MIN_PIN_LENGTH = 5
export const RECOMMENDED_PIN_LENGTH = 8
export const DEVICE_TYPES = { 0: 'Smart Lock 1/2', 2: 'Opener', 3: 'Smart Door', 4: 'Smart Lock 3/4' }

/** Overridable for tests. */
export const nukiApi = () => process.env.NUKI_API_BASE || 'https://api.nuki.io'

export const deviceLabel = (d) => DEVICE_TYPES[d.type] ?? `type ${d.type}`

/* ---------- pure helpers (unit tested) ---------- */

export function generatePin(length = RECOMMENDED_PIN_LENGTH) {
  let pin = ''
  for (let i = 0; i < length; i++) pin += randomInt(0, 10)
  return pin
}

export const isValidPin = (pin) => typeof pin === 'string' && pin.trim().length >= MIN_PIN_LENGTH

/** "https://Door.Example.com/path" -> "door.example.com"; returns null if it is not a hostname. */
export function normalizeDomain(input) {
  const host = input
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
  return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/.test(host) ? host : null
}

/** Returns the phone number if it looks like one, otherwise null. */
export function normalizePhone(input) {
  const phone = input.trim()
  return /^\+?\d{3,}$/.test(phone.replace(/[^\d+]/g, '')) && /^[\d\s+()/.-]+$/.test(phone) ? phone : null
}

export function parseDotenv(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let value = m[2]
    if (/^'.*'$/.test(value) || /^".*"$/.test(value)) value = value.slice(1, -1)
    values[m[1]] = value
  }
  return values
}

/** Sets (string) or removes (null) keys in .env text, keeping comments and unknown lines. */
export function updateDotenv(text, updates) {
  let lines = text === '' ? [] : text.replace(/\n$/, '').split(/\r?\n/)
  for (const [key, value] of Object.entries(updates)) {
    const isKey = (line) => new RegExp(`^\\s*${key}\\s*=`).test(line)
    if (value === null) {
      lines = lines.filter((line) => !isKey(line))
    } else if (lines.some(isKey)) {
      lines = lines.map((line) => (isKey(line) ? `${key}=${value}` : line))
    } else {
      lines.push(`${key}=${value}`)
    }
  }
  return lines.length ? `${lines.join('\n')}\n` : ''
}

/** Value for VITE_CONTACTS: single-quoted JSON (a literal ' inside is escaped as '). */
export function contactsToEnv(contacts) {
  if (!contacts.length) return null
  return `'${JSON.stringify(contacts).replace(/'/g, '\\u0027')}'`
}

const DOMAIN_START = '// --- custom domain (managed by `npm run setup`) ---'
const DOMAIN_END = '// --- end custom domain ---'
const EXAMPLE_ROUTE = '// "routes": [{ "pattern": "door.example.com", "custom_domain": true }],'

/** Reads the active custom domain from wrangler.jsonc text, or null. */
export function getCustomDomain(wranglerText) {
  const m = wranglerText.match(/^\s*"routes"\s*:\s*\[\s*\{\s*"pattern"\s*:\s*"([^"]+)"/m)
  return m ? m[1] : null
}

/** Writes (or clears) the custom domain between the markers in wrangler.jsonc. Returns null if the markers are missing. */
export function setCustomDomain(wranglerText, domain) {
  const re = new RegExp(`(${escapeRe(DOMAIN_START)}\\n)[\\s\\S]*?(\\n[ \\t]*${escapeRe(DOMAIN_END)})`)
  if (!re.test(wranglerText)) return null
  const body = domain
    ? `  "routes": [{ "pattern": "${domain}", "custom_domain": true }],`
    : `  ${EXAMPLE_ROUTE}`
  return wranglerText.replace(re, (_, start, end) => `${start}${body}${end}`)
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/* ---------- Nuki API ---------- */

/** @returns {Promise<{ok: true, devices: object[]} | {ok: false, status: number}>} */
export async function fetchSmartlocks(token) {
  const res = await fetch(`${nukiApi()}/smartlock`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  if (!res.ok) return { ok: false, status: res.status }
  return { ok: true, devices: await res.json() }
}

/* ---------- terminal prompts ---------- */

function question(prompt, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (hidden) {
      rl._writeToOutput = (text) => {
        // Print the prompt itself, hide everything typed afterwards.
        if (text.startsWith(prompt)) process.stdout.write(prompt)
      }
    }
    let answered = false
    rl.on('close', () => {
      if (!answered) {
        process.stdout.write('\n')
        process.exit(130) // Ctrl+C / Ctrl+D
      }
    })
    rl.question(prompt, (answer) => {
      answered = true
      rl.close()
      if (hidden) process.stdout.write('\n')
      resolve(answer)
    })
  })
}

export const ask = async (prompt, fallback = '') => {
  const suffix = fallback ? ` [${fallback}]` : ''
  const answer = (await question(`${prompt}${suffix}: `)).trim()
  return answer || fallback
}

export const askHidden = async (prompt) => (await question(`${prompt}: `, { hidden: true })).trim()

export async function confirm(prompt, defaultYes = true) {
  const answer = (await question(`${prompt} ${defaultYes ? '[Y/n]' : '[y/N]'}: `)).trim().toLowerCase()
  if (!answer) return defaultYes
  return answer.startsWith('y') || answer.startsWith('j')
}

/** Shows numbered options and returns the chosen index. */
export async function choose(prompt, options, defaultIndex = 0) {
  console.log(prompt)
  options.forEach((label, i) => console.log(`  ${i + 1}) ${label}`))
  for (;;) {
    const answer = await ask('>', String(defaultIndex + 1))
    const n = Number(answer)
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1
    console.log(`  1-${options.length}`)
  }
}
