#!/usr/bin/env node
// Interactive installer: npm run setup
//
// Walks you through Cloudflare login, Nuki token, device, PIN, opening hours, page settings,
// domain and Turnstile, then builds, deploys, uploads the secrets and checks the live page.
// Run it again at any time to change settings. `npm run setup -- --dry-run` changes nothing.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatOpenHours, isValidTimeZone, parseOpenHours, serializeOpenHours } from '../shared/hours.js'
import {
  ask,
  askHidden,
  choose,
  cloudflareApi,
  confirm,
  contactsToEnv,
  deviceLabel,
  fetchSmartlocks,
  generatePin,
  isValidPin,
  MIN_PIN_LENGTH,
  normalizeDomain,
  normalizePhone,
  parseDotenv,
  readManaged,
  RECOMMENDED_PIN_LENGTH,
  updateDotenv,
  workerName,
  writeManaged,
} from './lib.mjs'

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))

const DRY_RUN = process.argv.includes('--dry-run')
const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale
const isGerman = /^de/i.test(locale)
/** Picks the German or English text. */
const t = (de, en) => (isGerman ? de : en)

const TOTAL_STEPS = 7
const DAYTIME = '06:00-22:00'
const step = (n, title) => console.log(`\n\x1b[1m[${n}/${TOTAL_STEPS}] ${title}\x1b[0m`)
const info = (text) => console.log(`    ${text}`)
const warn = (text) => console.log(`\x1b[33m    ! ${text}\x1b[0m`)
const ok = (text) => console.log(`\x1b[32m✔ ${text}\x1b[0m`)
const fail = (text) => {
  console.error(`\n\x1b[31m✘ ${text}\x1b[0m`)
  process.exit(1)
}

/* ---------- running commands ---------- */

/** Extra environment for all wrangler calls (set once the Cloudflare account is known). */
const wranglerEnv = {}

function run(cmd, args, { input, capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
      shell: process.platform === 'win32',
      env: { ...process.env, ...wranglerEnv },
    })
    let output = ''
    child.stdout?.on('data', (d) => (output += d))
    child.stderr?.on('data', (d) => (output += d))
    if (input !== undefined) child.stdin.end(input)
    child.on('error', (err) => resolve({ code: 1, output: String(err) }))
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

const wrangler = (args, options) => run('npx', ['wrangler', ...args], options)

async function wranglerJson(args) {
  const { code, output } = await wrangler([...args, '--json'], { capture: true })
  if (code !== 0) return null
  try {
    return JSON.parse(output.slice(output.indexOf('{')))
  } catch {
    return null
  }
}

/* ---------- step 1: Cloudflare ---------- */

/** Logs in if needed and returns account ID, API token and the workers.dev subdomain. */
async function connectCloudflare() {
  let who = await wranglerJson(['whoami'])
  if (!who?.loggedIn) {
    info(t('Ein Browserfenster öffnet sich zur Anmeldung bei Cloudflare (kostenloses Konto genügt).', 'A browser window opens to log in to Cloudflare (a free account is enough).'))
    if ((await wrangler(['login'])).code !== 0) fail(t('Die Cloudflare-Anmeldung ist fehlgeschlagen.', 'Cloudflare login failed.'))
    who = await wranglerJson(['whoami'])
    if (!who?.loggedIn) fail(t('Die Cloudflare-Anmeldung ist fehlgeschlagen.', 'Cloudflare login failed.'))
  }
  const accounts = who.accounts ?? []
  if (!accounts.length) fail(t('Für dieses Cloudflare-Login wurde kein Konto gefunden.', 'No account found for this Cloudflare login.'))
  const account = accounts.length === 1 ? accounts[0] : accounts[await choose(t('Welches Cloudflare-Konto?', 'Which Cloudflare account?'), accounts.map((a) => a.name))]
  wranglerEnv.CLOUDFLARE_ACCOUNT_ID = account.id
  ok(`${t('Angemeldet', 'Logged in')}: ${who.email ?? ''} (${account.name})`)

  const token = (await wranglerJson(['auth', 'token']))?.token ?? null
  let subdomain = null
  if (token) {
    const res = await cloudflareApi(token, 'GET', `/accounts/${account.id}/workers/subdomain`)
    subdomain = res.ok ? (res.result?.subdomain ?? null) : null
  }
  return { accountId: account.id, token, subdomain }
}

/* ---------- step 2: Nuki ---------- */

async function askNukiDevice() {
  info(t('Erzeuge auf https://web.nuki.io unter „API“ einen Token mit den Rechten', 'Create a token at https://web.nuki.io under "API" with the permissions'))
  info(t('„Smartlocks lesen“ und „Smartlock-Aktionen ausführen“. Die Eingabe bleibt unsichtbar.', '"read smartlocks" and "execute smartlock actions". Your input stays hidden.'))
  for (;;) {
    const token = await askHidden(t('Nuki API-Token', 'Nuki API token'))
    if (!token) continue

    let result
    try {
      result = await fetchSmartlocks(token)
    } catch {
      fail(t('Die Nuki API ist nicht erreichbar. Prüfe deine Internetverbindung.', 'Could not reach the Nuki API. Check your internet connection.'))
    }

    if (!result.ok) {
      console.log(`  ✘ ${result.status === 401 || result.status === 403
        ? t('Der Token ist ungültig oder darf keine Smartlocks lesen.', 'The token is invalid or may not read smartlocks.')
        : `Nuki API: HTTP ${result.status}`}`)
      const next = await choose(t('Wie weiter?', 'What next?'), [
        t('Anderen Token eingeben', 'Enter another token'),
        t('Geräte-ID selbst eingeben (Token hat nur das Aktions-Recht)', 'Enter the device ID myself (token has the action permission only)'),
        t('Abbrechen', 'Quit'),
      ])
      if (next === 0) continue
      if (next === 2) fail(t('Abgebrochen.', 'Aborted.'))
      for (;;) {
        const id = await ask(t('Geräte-ID (Zahl aus „npm run smartlocks“)', 'Device ID (number from "npm run smartlocks")'))
        if (/^\d+$/.test(id)) return { token, device: { smartlockId: id, type: 2, name: t('(manuell)', '(manual)') } }
        console.log(`  ✘ ${t('Bitte nur Ziffern.', 'Digits only, please.')}`)
      }
    }

    if (!result.devices.length) {
      console.log(`  ✘ ${t('Der Token ist gültig, aber in diesem Account gibt es keine Geräte. Hängt der Opener an einem anderen Nuki-Account?', 'The token is valid, but this account has no devices. Is the Opener registered to a different Nuki account?')}`)
      if (await confirm(t('Mit einem anderen Token versuchen?', 'Try another token?'))) continue
      fail(t('Abgebrochen.', 'Aborted.'))
    }

    const openers = result.devices.filter((d) => d.type === 2)
    const candidates = openers.length ? openers : result.devices
    if (!openers.length) info(t('Kein Opener gefunden. Bei einem Smart Lock öffnet der Button die Falle.', 'No Opener found. On a Smart Lock the button unlatches the door.'))
    const label = (d) => `${deviceLabel(d)} "${d.name}" (ID ${d.smartlockId})`
    if (candidates.length === 1) {
      ok(label(candidates[0]))
      return { token, device: candidates[0] }
    }
    const index = await choose(t('Welches Gerät soll der Button öffnen?', 'Which device should the button open?'), candidates.map(label))
    return { token, device: candidates[index] }
  }
}

/* ---------- step 3: PIN ---------- */

async function askPin() {
  const mode = await choose(t('Wie soll der PIN entstehen, den Besucher eingeben?', 'How should the PIN that visitors enter be created?'), [
    t(`Zufällig erzeugen (${RECOMMENDED_PIN_LENGTH} Ziffern, empfohlen)`, `Generate randomly (${RECOMMENDED_PIN_LENGTH} digits, recommended)`),
    t('Selbst wählen', 'Choose my own'),
  ])
  if (mode === 0) return { pin: generatePin(), generated: true }

  for (;;) {
    const pin = await askHidden(t(`PIN (mindestens ${MIN_PIN_LENGTH} Zeichen, am besten nur Ziffern)`, `PIN (at least ${MIN_PIN_LENGTH} characters, digits recommended)`))
    if (!isValidPin(pin)) {
      console.log(`  ✘ ${t(`Mindestens ${MIN_PIN_LENGTH} Zeichen, bitte.`, `At least ${MIN_PIN_LENGTH} characters, please.`)}`)
      continue
    }
    if (pin !== (await askHidden(t('PIN wiederholen', 'Repeat PIN')))) {
      console.log(`  ✘ ${t('Die Eingaben stimmen nicht überein.', 'The entries do not match.')}`)
      continue
    }
    if (pin.length < RECOMMENDED_PIN_LENGTH) info(t(`Hinweis: Ab ${RECOMMENDED_PIN_LENGTH} Ziffern ist der PIN deutlich schwerer zu erraten.`, `Note: a PIN of ${RECOMMENDED_PIN_LENGTH}+ digits is much harder to guess.`))
    return { pin, generated: false }
  }
}

/* ---------- step 4: opening hours ---------- */

async function askOpenHours(current) {
  info(t('Außerhalb dieser Zeiten lässt sich die Tür nicht öffnen, auch nicht mit dem richtigen PIN.', 'Outside these times the door cannot be opened, not even with the right PIN.'))
  const currentHours = current.OPEN_HOURS ?? ''
  const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin'
  // Fresh install: suggest daytime. TIMEZONE without OPEN_HOURS means "around the clock" was chosen before.
  const preset = currentHours === '' ? (current.TIMEZONE ? 0 : 1) : currentHours === DAYTIME ? 1 : 2
  const choice = await choose(t('Wann darf geöffnet werden?', 'When may the door be opened?'), [
    t('Rund um die Uhr', 'Around the clock'),
    t(`Tagsüber, ${formatOpenHours(parseOpenHours(DAYTIME))} Uhr (empfohlen)`, `Daytime, ${formatOpenHours(parseOpenHours(DAYTIME))} (recommended)`),
    t('Eigene Zeiten', 'Custom times'),
  ], preset)
  if (choice === 0) return { hours: '', timeZone: current.TIMEZONE || systemZone }

  let hours = DAYTIME
  if (choice === 2) {
    for (;;) {
      const ranges = parseOpenHours(await ask(t('Zeiten, z. B. 07:00-12:00,14:00-21:00', 'Times, e.g. 07:00-12:00,14:00-21:00'), currentHours || '07:00-21:00'))
      if (ranges?.length) {
        hours = serializeOpenHours(ranges)
        break
      }
      console.log(`  ✘ ${t('Format: HH:MM-HH:MM, mehrere mit Komma getrennt.', 'Format: HH:MM-HH:MM, several separated by commas.')}`)
    }
  }
  for (;;) {
    const timeZone = await ask(t('Zeitzone', 'Time zone'), current.TIMEZONE || systemZone)
    if (isValidTimeZone(timeZone)) return { hours, timeZone }
    console.log(`  ✘ ${t('Unbekannte Zeitzone, z. B. Europe/Berlin.', 'Unknown time zone, e.g. Europe/Berlin.')}`)
  }
}

/* ---------- step 5: page ---------- */

async function askContacts(existingRaw) {
  let existing = []
  try {
    const parsed = JSON.parse(existingRaw ?? '[]')
    if (Array.isArray(parsed)) existing = parsed
  } catch {
    /* ignore a broken value */
  }
  if (existing.length) {
    const list = existing.map((c) => `${c.label ? `${c.label}: ` : ''}${c.phone}`).join(', ')
    if (await confirm(t(`Telefonnummern behalten (${list})?`, `Keep phone numbers (${list})?`))) return existing
  }
  const contacts = []
  info(t('Diese Nummern erscheinen auf der Seite, falls etwas nicht klappt. Leer lassen = fertig.', 'These numbers are shown on the page if something goes wrong. Leave empty to finish.'))
  for (;;) {
    const raw = await ask(t(`Telefonnummer ${contacts.length + 1}`, `Phone number ${contacts.length + 1}`))
    if (!raw) break
    const phone = normalizePhone(raw)
    if (!phone) {
      console.log(`  ✘ ${t('Das sieht nicht wie eine Telefonnummer aus.', 'That does not look like a phone number.')}`)
      continue
    }
    const label = await ask(t('Name dazu (optional)', 'Name for it (optional)'))
    contacts.push(label ? { label, phone } : { phone })
  }
  return contacts
}

/* ---------- step 6: address and Turnstile ---------- */

async function askDomain(current) {
  info(t('Eigene Domain, z. B. tuer.example.com. Sie muss bei Cloudflare in deinem Konto liegen.', 'Your own domain, e.g. door.example.com. It must be managed by Cloudflare in your account.'))
  info(t('Leer lassen = kostenlose *.workers.dev-Adresse.', 'Leave empty to use the free *.workers.dev address.'))
  for (;;) {
    const raw = await ask('Domain', current ?? '')
    if (!raw) return null
    const domain = normalizeDomain(raw)
    if (domain) return domain
    console.log(`  ✘ ${t('Das ist kein gültiger Hostname.', 'That is not a valid hostname.')}`)
  }
}

/** Creates or updates the Turnstile widget for `hostname`. Returns { siteKey, secret? } or null. */
async function setupTurnstile(cf, hostname, existingSiteKey, name) {
  if (!cf.token) return null
  const body = { name, domains: [hostname], mode: 'managed' }
  const base = `/accounts/${cf.accountId}/challenges/widgets`
  if (existingSiteKey) {
    const updated = await cloudflareApi(cf.token, 'PUT', `${base}/${existingSiteKey}`, body)
    if (updated.ok) return { siteKey: existingSiteKey, secret: updated.result?.secret }
  }
  const created = await cloudflareApi(cf.token, 'POST', base, body)
  if (created.ok && created.result?.sitekey && created.result?.secret) return { siteKey: created.result.sitekey, secret: created.result.secret }
  warn(`Turnstile: ${created.error ?? t('unbekannter Fehler', 'unknown error')}`)
  return null
}

/* ---------- after deploy ---------- */

async function postOpen(baseUrl, pin) {
  const res = await fetch(`${baseUrl}/api/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin }),
    signal: AbortSignal.timeout(20000),
  })
  return { status: res.status, error: (await res.json().catch(() => ({}))).error }
}

/** Waits until the Worker answers as fully configured (a new domain can take a minute). */
async function waitUntilLive(baseUrl) {
  const probe = `wrong-${generatePin(6)}`
  for (let attempt = 1; attempt <= 18; attempt++) {
    try {
      const { error } = await postOpen(baseUrl, probe)
      // Each of these means: configured and refusing correctly.
      if (['wrong_pin', 'closed', 'captcha_failed'].includes(error)) return true
    } catch {
      /* DNS or certificate not ready yet */
    }
    if (attempt === 1) info(t('Warte, bis die Seite erreichbar ist (bei neuer Domain bis zu 1–2 Minuten) …', 'Waiting for the page to come online (1–2 minutes for a new domain) …'))
    await new Promise((r) => setTimeout(r, 5000))
  }
  return false
}

/* ---------- main ---------- */

console.log(`\n\x1b[1m${t('Nuki Opener Link – Einrichtung', 'Nuki Opener Link – setup')}\x1b[0m`)
console.log(t('Dauert etwa 5 Minuten. Mit Strg+C kannst du jederzeit abbrechen.', 'Takes about 5 minutes. Press Ctrl+C at any time to quit.'))
if (DRY_RUN) console.log(`\x1b[33m${t('Testlauf (--dry-run): Es wird nichts geschrieben oder hochgeladen.', 'Dry run (--dry-run): nothing is written or uploaded.')}\x1b[0m`)

if (Number(process.versions.node.split('.')[0]) < 20) fail(t('Bitte Node.js 20 oder neuer installieren.', 'Please install Node.js 20 or newer.'))
if (!existsSync('node_modules')) fail(t('Bitte zuerst „npm install“ ausführen.', 'Please run "npm install" first.'))

const envText = existsSync('.env') ? await readFile('.env', 'utf8') : ''
const currentEnv = parseDotenv(envText)
const wranglerText = await readFile('wrangler.jsonc', 'utf8')
const managed = readManaged(wranglerText)
if (!managed) fail(t('In wrangler.jsonc fehlt der Block „managed by `npm run setup`“. Bitte die Datei aus dem Repo wiederherstellen.', 'wrangler.jsonc lacks the "managed by `npm run setup`" block. Please restore the file from the repository.'))
const name = workerName(wranglerText)

step(1, t('Cloudflare-Anmeldung', 'Cloudflare login'))
const cf = DRY_RUN ? { accountId: null, token: null, subdomain: '<subdomain>' } : await connectCloudflare()
if (DRY_RUN) info(t('(übersprungen)', '(skipped)'))

step(2, t('Nuki-Zugang und Gerät', 'Nuki access and device'))
const { device, token: nukiToken } = await askNukiDevice()

step(3, t('PIN für Besucher', 'PIN for visitors'))
const { pin, generated } = await askPin()

step(4, t('Öffnungszeiten', 'Opening hours'))
const { hours, timeZone } = await askOpenHours(managed.vars)

step(5, t('Aussehen der Seite', 'Look of the page'))
const localeChoice = await choose(
  t('Sprache der Seite?', 'Language of the page?'),
  [t('Automatisch nach Browsersprache', 'Automatic, follows the browser'), 'Deutsch', 'English'],
  ['de', 'en'].includes(currentEnv.VITE_LOCALE) ? ['de', 'en'].indexOf(currentEnv.VITE_LOCALE) + 1 : 0,
)
const siteLocale = ['auto', 'de', 'en'][localeChoice]
const title = await ask(t('Überschrift (leer = „Haustür“ bzw. „Front door“)', 'Heading (empty = "Front door" / "Haustür")'), currentEnv.VITE_SITE_TITLE ?? '')
const contacts = await askContacts(currentEnv.VITE_CONTACTS)

step(6, t('Adresse und Bot-Schutz', 'Address and bot protection'))
const domain = await askDomain(managed.domain)
const hostname = domain ?? (cf.subdomain ? `${name}.${cf.subdomain}.workers.dev` : null)
if (!hostname) warn(t('Für dein Konto ist noch keine workers.dev-Subdomain eingerichtet; sie wird beim Deploy angelegt.', 'Your account has no workers.dev subdomain yet; it is created during deploy.'))
info(t('Cloudflare Turnstile prüft unsichtbar, ob ein Mensch tippt (meist ohne Klick). Das stoppt Bots,', 'Cloudflare Turnstile checks invisibly that a human is tapping (usually without a click). It stops bots'))
info(t('braucht aber eine Verbindung zu Cloudflare beim Öffnen der Seite. Kostenlos.', 'but needs a connection to Cloudflare when the page loads. Free.'))
const useTurnstile = hostname !== null && (await confirm(t('Turnstile einschalten? (empfohlen)', 'Enable Turnstile? (recommended)'), true))

console.log(`\n${t('Zusammenfassung', 'Summary')}:`)
const summary = [
  [t('Gerät', 'Device'), `${deviceLabel(device)} "${device.name}"`],
  ['PIN', `${generated ? t('zufällig erzeugt', 'randomly generated') : t('selbst gewählt', 'your own')} (${pin.length} ${t('Zeichen', 'characters')})`],
  [t('Öffnungszeiten', 'Opening hours'), hours ? `${formatOpenHours(parseOpenHours(hours))} (${timeZone})` : t('rund um die Uhr', 'around the clock')],
  [t('Sprache', 'Language'), siteLocale],
  [t('Telefon', 'Phone'), contacts.length ? contacts.map((c) => c.phone).join(', ') : t('keine', 'none')],
  [t('Adresse', 'Address'), hostname ? `https://${hostname}` : '*.workers.dev'],
  ['Turnstile', useTurnstile ? t('an', 'on') : t('aus', 'off')],
]
const width = Math.max(...summary.map(([label]) => label.length)) + 2
for (const [label, value] of summary) info(`${`${label}:`.padEnd(width)}${value}`)

const vars = { ...managed.vars, OPEN_HOURS: hours || undefined, TIMEZONE: timeZone }
const settings = { domain, vars }

if (DRY_RUN) {
  console.log(`\n${t('Testlauf beendet. Das würde geschrieben:', 'Dry run finished. This would be written:')}`)
  console.log(writeManaged(wranglerText, settings).match(/\/\/ --- managed[\s\S]*?end managed[^\n]*/)[0])
  const widgetStep = useTurnstile ? t('Turnstile-Widget anlegen, ', 'create the Turnstile widget, ') : ''
  console.log(t(`Danach: .env schreiben, ${widgetStep}bauen, deployen, Secrets setzen, testen.`, `Then: write .env, ${widgetStep}build, deploy, set secrets, test.`))
  process.exit(0)
}

if (!(await confirm(`\n${t('Jetzt einrichten und veröffentlichen?', 'Set up and publish now?')}`))) fail(t('Abgebrochen, es wurde nichts verändert.', 'Aborted, nothing was changed.'))

step(7, t('Veröffentlichen', 'Publishing'))

const secrets = { NUKI_API_TOKEN: nukiToken, NUKI_SMARTLOCK_ID: String(device.smartlockId), ACCESS_PIN: pin }
let siteKey = null
if (useTurnstile) {
  const widget = await setupTurnstile(cf, hostname, currentEnv.VITE_TURNSTILE_SITE_KEY, name)
  if (widget) {
    siteKey = widget.siteKey
    if (widget.secret) secrets.TURNSTILE_SECRET_KEY = widget.secret
    ok(t('Turnstile-Widget eingerichtet.', 'Turnstile widget ready.'))
  } else {
    warn(t('Turnstile konnte nicht eingerichtet werden. Die Seite läuft ohne; „npm run setup“ später erneut versuchen.', 'Turnstile could not be set up. The page runs without it; try "npm run setup" again later.'))
  }
}
if (!siteKey && currentEnv.VITE_TURNSTILE_SITE_KEY) secrets.TURNSTILE_SECRET_KEY = null // switched off: delete the old secret

await writeFile(
  '.env',
  updateDotenv(envText, {
    VITE_SITE_TITLE: title || null,
    VITE_CONTACTS: contactsToEnv(contacts),
    VITE_LOCALE: siteLocale === 'auto' ? null : siteLocale,
    VITE_TURNSTILE_SITE_KEY: siteKey,
  }),
)
await writeFile('wrangler.jsonc', writeManaged(wranglerText, settings))

if ((await run('npm', ['run', 'build'])).code !== 0) fail(t('Der Build ist fehlgeschlagen.', 'The build failed.'))
if ((await wrangler(['deploy'])).code !== 0) {
  fail(domain
    ? t('Das Deployen ist fehlgeschlagen. Liegt die Domain in deinem Cloudflare-Konto? Sonst „npm run setup“ ohne Domain starten.', 'Deploy failed. Is the domain managed by Cloudflare in your account? Otherwise run "npm run setup" without a domain.')
    : t('Das Deployen ist fehlgeschlagen.', 'Deploy failed.'))
}

// Secrets go in via stdin so that they never appear in the process list or shell history.
info(t('Lade die Secrets hoch …', 'Uploading the secrets …'))
if ((await wrangler(['secret', 'bulk'], { input: JSON.stringify(secrets) })).code !== 0) {
  fail(t('Die Secrets konnten nicht hochgeladen werden. „npm run setup“ erneut ausführen.', 'Uploading the secrets failed. Run "npm run setup" again.'))
}

// The workers.dev subdomain may only exist after the first deploy.
let liveHost = hostname
if (!liveHost && cf.token) {
  const res = await cloudflareApi(cf.token, 'GET', `/accounts/${cf.accountId}/workers/subdomain`)
  if (res.ok && res.result?.subdomain) liveHost = `${name}.${res.result.subdomain}.workers.dev`
}
const baseUrl = liveHost ? `https://${liveHost}` : null

if (baseUrl && (await waitUntilLive(baseUrl))) {
  ok(t('Die Seite ist online und prüft den PIN.', 'The page is online and checks the PIN.'))
  if (!siteKey && (await confirm(t('Türsummer jetzt testen? (löst wirklich aus)', 'Test the door buzzer now? (really triggers it)'), false))) {
    const { status, error } = await postOpen(baseUrl, pin).catch(() => ({ status: 0 }))
    if (status === 200) ok(t('Befehl an Nuki gesendet. Hat der Summer geklingelt?', 'Command sent to Nuki. Did the buzzer sound?'))
    else warn(t(`Antwort ${status} ${error ?? ''}. Details: npx wrangler tail, dann erneut versuchen.`, `Response ${status} ${error ?? ''}. Details: npx wrangler tail, then try again.`))
  }
} else if (baseUrl) {
  warn(t('Die Seite antwortet noch nicht. Bei einer neuen Domain kann das ein paar Minuten dauern.', 'The page does not answer yet. A new domain can take a few minutes.'))
}

console.log(`\n\x1b[1m${t('Fertig!', 'Done!')}\x1b[0m`)
if (baseUrl) {
  info(`${t('Seite', 'Page')}:  ${baseUrl}`)
  info(`${t('Link mit PIN', 'Link with PIN')}:  ${baseUrl}/#pin=${encodeURIComponent(pin)}`)
  if (siteKey) info(t('Teste den Button einmal im Browser.', 'Try the button once in your browser.'))
}
if (generated) info(`PIN:  ${pin}   ← ${t('jetzt notieren, er wird nicht noch einmal angezeigt', 'write it down now, it will not be shown again')}`)
info(t('Einstellungen ändern: npm run setup  ·  Nur PIN ändern: npx wrangler secret put ACCESS_PIN', 'Change settings: npm run setup  ·  Change only the PIN: npx wrangler secret put ACCESS_PIN'))
