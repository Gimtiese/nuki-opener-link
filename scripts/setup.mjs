#!/usr/bin/env node
// Interactive installer: npm run setup
//
// Walks you through Cloudflare login, Nuki token, device selection, PIN, page settings and
// custom domain, then builds, deploys, uploads the secrets and tests the result.
// Use `npm run setup -- --dry-run` to go through all questions without changing anything.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ask,
  askHidden,
  choose,
  confirm,
  contactsToEnv,
  deviceLabel,
  fetchSmartlocks,
  generatePin,
  getCustomDomain,
  isValidPin,
  MIN_PIN_LENGTH,
  normalizeDomain,
  normalizePhone,
  parseDotenv,
  RECOMMENDED_PIN_LENGTH,
  setCustomDomain,
  updateDotenv,
} from './lib.mjs'

process.chdir(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'))

const DRY_RUN = process.argv.includes('--dry-run')
const locale = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale
const isGerman = /^de/i.test(locale)
/** Picks the German or English text. */
const t = (de, en) => (isGerman ? de : en)

const TOTAL_STEPS = 6
const step = (n, title) => console.log(`\n\x1b[1m[${n}/${TOTAL_STEPS}] ${title}\x1b[0m`)
const info = (text) => console.log(`    ${text}`)
const fail = (text) => {
  console.error(`\n\x1b[31m✘ ${text}\x1b[0m`)
  process.exit(1)
}

/* ---------- running commands ---------- */

function run(cmd, args, { input, capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
      shell: process.platform === 'win32',
    })
    let output = ''
    child.stdout?.on('data', (d) => (output += d))
    child.stderr?.on('data', (d) => (output += d))
    if (input !== undefined) child.stdin.end(input)
    child.on('error', (err) => resolve({ code: 1, output: String(err) }))
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

const npx = (...args) => run('npx', args)

async function ensureCloudflareLogin() {
  const who = await run('npx', ['wrangler', 'whoami'], { capture: true })
  if (who.code === 0 && !/not authenticated|nicht angemeldet/i.test(who.output)) {
    info(t('Du bist bei Cloudflare angemeldet.', 'You are logged in to Cloudflare.'))
    return
  }
  info(t('Ein Browserfenster öffnet sich zur Anmeldung bei Cloudflare (kostenloses Konto genügt).', 'A browser window opens to log in to Cloudflare (a free account is enough).'))
  const login = await npx('wrangler', 'login')
  if (login.code !== 0) fail(t('Die Cloudflare-Anmeldung ist fehlgeschlagen.', 'Cloudflare login failed.'))
}

/* ---------- the questions ---------- */

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
      const reason =
        result.status === 401 || result.status === 403
          ? t('Der Token ist ungültig oder darf keine Smartlocks lesen.', 'The token is invalid or may not read smartlocks.')
          : `HTTP ${result.status}`
      console.log(`  ✘ ${reason}`)
      if (await confirm(t('Noch einmal versuchen?', 'Try again?'))) continue
      fail(t('Abgebrochen.', 'Aborted.'))
    }
    if (!result.devices.length) {
      console.log(`  ✘ ${t('Der Token ist gültig, aber in diesem Account gibt es keine Geräte. Hängt der Opener an einem anderen Nuki-Account?', 'The token is valid, but this account has no devices. Is the Opener registered to a different Nuki account?')}`)
      if (await confirm(t('Mit einem anderen Token versuchen?', 'Try another token?'))) continue
      fail(t('Abgebrochen.', 'Aborted.'))
    }

    const openers = result.devices.filter((d) => d.type === 2)
    const candidates = openers.length ? openers : result.devices
    if (!openers.length) {
      info(t('Kein Opener gefunden. Es werden alle Geräte angeboten (bei einem Smart Lock öffnet der Button die Falle).', 'No Opener found. All devices are offered (on a Smart Lock the button unlatches the door).'))
    }
    const label = (d) => `${deviceLabel(d)} "${d.name}" (ID ${d.smartlockId})`
    if (candidates.length === 1) {
      info(`✔ ${label(candidates[0])}`)
      return { device: candidates[0], token }
    }
    const index = await choose(t('Welches Gerät soll der Button öffnen?', 'Which device should the button open?'), candidates.map(label))
    return { device: candidates[index], token }
  }
}

async function askPin() {
  const mode = await choose(
    t('Wie soll der PIN entstehen, den Besucher eingeben?', 'How should the PIN that visitors enter be created?'),
    [
      t(`Zufällig erzeugen (${RECOMMENDED_PIN_LENGTH} Ziffern, empfohlen)`, `Generate randomly (${RECOMMENDED_PIN_LENGTH} digits, recommended)`),
      t('Selbst wählen', 'Choose my own'),
    ],
    0,
  )
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
    if (pin.length < RECOMMENDED_PIN_LENGTH) {
      info(t(`Hinweis: Ab ${RECOMMENDED_PIN_LENGTH} Ziffern ist der PIN deutlich schwerer zu erraten.`, `Note: a PIN of ${RECOMMENDED_PIN_LENGTH}+ digits is much harder to guess.`))
    }
    return { pin: pin.trim(), generated: false }
  }
}

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
    if (await confirm(t(`Bestehende Telefonnummern behalten (${list})?`, `Keep existing phone numbers (${list})?`))) return existing
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

async function askDomain(current) {
  info(t('Eigene Domain, z. B. door.example.com. Die Domain muss bei Cloudflare in deinem Konto liegen.', 'Your own domain, e.g. door.example.com. The domain must be managed by Cloudflare in your account.'))
  info(t('Leer lassen = kostenlose *.workers.dev-Adresse.', 'Leave empty to use the free *.workers.dev address.'))
  for (;;) {
    const raw = await ask(t('Domain', 'Domain'), current ?? '')
    if (!raw) return null
    const domain = normalizeDomain(raw)
    if (domain) return domain
    console.log(`  ✘ ${t('Das ist kein gültiger Hostname.', 'That is not a valid hostname.')}`)
  }
}

/* ---------- after deploy ---------- */

async function postOpen(baseUrl, pin) {
  const res = await fetch(`${baseUrl}/api/open`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin }),
    signal: AbortSignal.timeout(20000),
  })
  return res.status
}

/** Waits until the Worker answers (a new custom domain can take a minute for DNS and certificate). */
async function waitUntilLive(baseUrl) {
  const wrongPin = `wrong-${generatePin(6)}`
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const status = await postOpen(baseUrl, wrongPin)
      if (status === 401) return true // configured and rejecting a wrong PIN: exactly what we want
    } catch {
      /* DNS or certificate not ready yet */
    }
    if (attempt === 1) info(t('Warte, bis die Seite erreichbar ist (bei neuer Domain bis zu einer Minute) …', 'Waiting for the page to come online (up to a minute for a new domain) …'))
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

step(1, t('Cloudflare-Anmeldung', 'Cloudflare login'))
if (DRY_RUN) info(t('(übersprungen)', '(skipped)'))
else await ensureCloudflareLogin()

step(2, t('Nuki-Zugang und Gerät', 'Nuki access and device'))
const { device, token } = await askNukiDevice()

step(3, t('PIN für Besucher', 'PIN for visitors'))
const { pin, generated } = await askPin()

step(4, t('Aussehen der Seite', 'Look of the page'))
const localeChoice = await choose(
  t('Sprache der Seite?', 'Language of the page?'),
  [t('Automatisch nach Browsersprache', 'Automatic, follows the browser'), 'Deutsch', 'English'],
  ['de', 'en'].includes(currentEnv.VITE_LOCALE) ? ['de', 'en'].indexOf(currentEnv.VITE_LOCALE) + 1 : 0,
)
const siteLocale = ['auto', 'de', 'en'][localeChoice]
const title = await ask(t('Überschrift (leer = „Haustür“ bzw. „Front door“)', 'Heading (empty = "Front door" / "Haustür")'), currentEnv.VITE_SITE_TITLE ?? '')
const contacts = await askContacts(currentEnv.VITE_CONTACTS)

step(5, t('Adresse', 'Address'))
const domain = await askDomain(getCustomDomain(wranglerText))

console.log(`\n${t('Zusammenfassung', 'Summary')}:`)
info(`${t('Gerät', 'Device')}:    ${deviceLabel(device)} "${device.name}"`)
info(`PIN:       ${generated ? t('zufällig erzeugt', 'randomly generated') : t('selbst gewählt', 'your own')} (${pin.length} ${t('Zeichen', 'characters')})`)
info(`${t('Sprache', 'Language')}:   ${siteLocale}`)
info(`${t('Telefon', 'Phone')}:     ${contacts.length ? contacts.map((c) => c.phone).join(', ') : t('keine', 'none')}`)
info(`${t('Adresse', 'Address')}:   ${domain ? `https://${domain}` : t('*.workers.dev (wird beim Deploy angezeigt)', '*.workers.dev (shown during deploy)')}`)

const newEnvText = updateDotenv(envText, {
  VITE_SITE_TITLE: title || null,
  VITE_CONTACTS: contactsToEnv(contacts),
  VITE_LOCALE: siteLocale === 'auto' ? null : siteLocale,
})
const newWranglerText = setCustomDomain(wranglerText, domain)

if (DRY_RUN) {
  console.log(`\n${t('Testlauf beendet. Das würde geschrieben:', 'Dry run finished. This would be written:')}`)
  console.log('--- .env ---\n' + (newEnvText || '(empty)\n') + '------------')
  console.log(`wrangler.jsonc: ${domain ? `routes → ${domain}` : t('keine eigene Domain', 'no custom domain')}`)
  console.log(t('Danach: bauen, deployen, Secrets setzen (NUKI_API_TOKEN, NUKI_SMARTLOCK_ID, ACCESS_PIN), testen.', 'Then: build, deploy, set secrets (NUKI_API_TOKEN, NUKI_SMARTLOCK_ID, ACCESS_PIN), test.'))
  process.exit(0)
}

if (!(await confirm(`\n${t('Jetzt bauen und veröffentlichen?', 'Build and publish now?')}`))) fail(t('Abgebrochen, es wurde nichts verändert.', 'Aborted, nothing was changed.'))

step(6, t('Veröffentlichen', 'Publishing'))
await writeFile('.env', newEnvText)
if (newWranglerText === null) {
  info(t('Hinweis: In wrangler.jsonc fehlen die Markierungen für die Domain. Trage sie bei Bedarf selbst ein.', 'Note: wrangler.jsonc has no domain markers. Add the domain yourself if needed.'))
} else {
  await writeFile('wrangler.jsonc', newWranglerText)
}

if ((await run('npm', ['run', 'build'])).code !== 0) fail(t('Der Build ist fehlgeschlagen.', 'The build failed.'))
if ((await npx('wrangler', 'deploy')).code !== 0) {
  fail(domain
    ? t('Das Deployen ist fehlgeschlagen. Liegt die Domain in deinem Cloudflare-Konto? Ohne Domain erneut „npm run setup“ starten.', 'Deploy failed. Is the domain managed by Cloudflare in your account? Run "npm run setup" again without a domain to use workers.dev.')
    : t('Das Deployen ist fehlgeschlagen.', 'Deploy failed.'))
}

// Secrets go in via stdin so that they never appear in the process list or shell history.
info(t('Lade die Secrets hoch …', 'Uploading the secrets …'))
const secrets = JSON.stringify({ NUKI_API_TOKEN: token, NUKI_SMARTLOCK_ID: String(device.smartlockId), ACCESS_PIN: pin })
if ((await run('npx', ['wrangler', 'secret', 'bulk'], { input: secrets })).code !== 0) {
  fail(t('Die Secrets konnten nicht hochgeladen werden. „npm run setup“ erneut ausführen.', 'Uploading the secrets failed. Run "npm run setup" again.'))
}

let baseUrl = domain ? `https://${domain}` : null
if (!baseUrl) {
  const typed = (await ask(t('Die *.workers.dev-Adresse aus der Ausgabe oben (Enter = Test überspringen)', 'The *.workers.dev address from the output above (Enter to skip the test)'))).replace(/\/+$/, '')
  if (/^https:\/\/[^\s/]+$/.test(typed)) baseUrl = typed
}

if (baseUrl) {
  if (await waitUntilLive(baseUrl)) {
    console.log(`\x1b[32m✔ ${t('Die Seite ist online und prüft den PIN.', 'The page is online and checks the PIN.')}\x1b[0m`)
    if (await confirm(t('Türsummer jetzt testen? (löst wirklich aus)', 'Test the door buzzer now? (really triggers it)'), false)) {
      const status = await postOpen(baseUrl, pin).catch(() => 0)
      if (status === 200) console.log(`\x1b[32m✔ ${t('Befehl an Nuki gesendet. Hat der Summer geklingelt?', 'Command sent to Nuki. Did the buzzer sound?')}\x1b[0m`)
      else console.log(`\x1b[33m✘ ${t(`Antwort ${status}. Mehr Details: npx wrangler tail, dann Button tippen.`, `Response ${status}. Details: npx wrangler tail, then tap the button.`)}\x1b[0m`)
    }
  } else {
    info(t('Die Seite antwortet noch nicht. Bei einer neuen Domain kann das einige Minuten dauern, dann einfach erneut öffnen.', 'The page does not answer yet. A new domain can take a few minutes; just try again later.'))
  }
}

console.log(`\n\x1b[1m${t('Fertig!', 'Done!')}\x1b[0m`)
if (baseUrl) {
  info(`${t('Seite', 'Page')}:  ${baseUrl}`)
  info(`${t('Link mit vorausgefülltem PIN', 'Link with PIN pre-filled')}:  ${baseUrl}/#pin=${encodeURIComponent(pin)}`)
}
if (generated) info(`PIN:    ${pin}   ← ${t('jetzt notieren, er wird nicht noch einmal angezeigt', 'write it down now, it will not be shown again')}`)
info(t('PIN später ändern: npx wrangler secret put ACCESS_PIN', 'Change the PIN later: npx wrangler secret put ACCESS_PIN'))
info(t('Änderungen an Seite/Domain: npm run setup (oder .env bearbeiten und npm run deploy)', 'Change page/domain: npm run setup (or edit .env and run npm run deploy)'))
