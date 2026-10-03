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

/* ---------- managed block in wrangler.jsonc (domain + vars) ---------- */

const MANAGED_START = '// --- managed by `npm run setup` ---'
const MANAGED_END = '// --- end managed by `npm run setup` ---'
// Also matches the markers of older versions, which only managed the domain.
const MANAGED_RE =
  /\/\/ --- (?:managed by `npm run setup`|custom domain \(managed by `npm run setup`\)) ---\n([\s\S]*?)\n([ \t]*)\/\/ --- end (?:managed by `npm run setup`|custom domain) ---/

const EXAMPLE_ROUTES = '// "routes": [{ "pattern": "door.example.com", "custom_domain": true }],'
const EXAMPLE_VARS = '// "vars": { "OPEN_HOURS": "06:00-22:00", "TIMEZONE": "Europe/Berlin" },'

/**
 * Reads domain and vars from the managed block of wrangler.jsonc.
 * @returns {{ domain: string | null, vars: Record<string, string> } | null} null if the block is missing
 */
export function readManaged(wranglerText) {
  const block = wranglerText.match(MANAGED_RE)?.[1]
  if (block === undefined) return null
  const domain = block.match(/^\s*"routes"\s*:\s*\[\s*\{\s*"pattern"\s*:\s*"([^"]+)"/m)?.[1] ?? null
  let vars = {}
  const varsLine = block.match(/^\s*"vars"\s*:\s*(\{.*\})\s*,?\s*$/m)?.[1]
  if (varsLine) {
    try {
      vars = JSON.parse(varsLine)
    } catch {
      vars = {}
    }
  }
  return { domain, vars }
}

/**
 * Writes domain and vars into the managed block. Returns null if the block is missing.
 * @param {string} wranglerText
 * @param {{ domain: string | null, vars: Record<string, string> }} settings
 */
export function writeManaged(wranglerText, { domain, vars }) {
  if (!MANAGED_RE.test(wranglerText)) return null
  const entries = Object.entries(vars).filter(([, v]) => v !== undefined && v !== null && v !== '')
  const lines = domain
    ? [`"routes": [{ "pattern": "${domain}", "custom_domain": true }],`, '"workers_dev": false,', '"preview_urls": false,']
    : [EXAMPLE_ROUTES]
  lines.push(
    entries.length
      ? `"vars": { ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(String(v))}`).join(', ')} },`
      : EXAMPLE_VARS,
  )
  return wranglerText.replace(MANAGED_RE, (_, _body, indent) =>
    [MANAGED_START, ...lines, MANAGED_END].map((line, i) => (i === 0 ? line : `${indent}${line}`)).join('\n'),
  )
}

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

/* ---------- Cloudflare API (uses the token of `wrangler login`) ---------- */

/** @returns {Promise<{ ok: boolean, result?: any, error?: string }>} */
export async function cloudflareApi(token, method, path, body) {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (res.ok && data.success) return { ok: true, result: data.result }
    return { ok: false, error: (data.errors ?? []).map((e) => e.message).join('; ') || `HTTP ${res.status}` }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/** Reads the worker name from wrangler.jsonc. */
export const workerName = (wranglerText) => wranglerText.match(/^\s*"name"\s*:\s*"([^"]+)"/m)?.[1] ?? 'nuki-opener-link'
