# Nuki Opener Link

[![CI](https://github.com/Gimtiese/nuki-opener-link/actions/workflows/ci.yml/badge.svg)](https://github.com/Gimtiese/nuki-opener-link/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

*Deutsche Anleitung: [README.de.md](README.de.md)*

A one-button web page that lets delivery people buzz open your door. It triggers the door
buzzer of your **[Nuki Opener](https://nuki.io/en/opener/)** through the Nuki Web API.
Built with Vue 3 + TypeScript and hosted for free on Cloudflare Workers.

- **One tap**: PIN, big button, done. Works on any phone, no app, no account for visitors.
- **Your Nuki token never reaches the browser.** It lives as a Worker secret.
- **Protected by a shared PIN** with per-IP rate limiting and constant-time comparison.
- **Reliable**: automatic retries against the Nuki API, clear error messages, phone numbers to call as a fallback.
- **Free**: Cloudflare Workers free plan (static assets are not billed as requests) and the Nuki Web API.
- English and German UI (follows the browser language), dark mode, strict CSP, `noindex`.

```
Phone ──POST /api/open {pin}──▶ Cloudflare Worker ──POST api.nuki.io/smartlock/{id}/action──▶ Nuki Cloud ▶ Bridge ▶ Opener
```

> **Not affiliated with Nuki.** "Nuki" is a trademark of Nuki Home Solutions GmbH.
> This opens a door: read [Security](#security) before you publish it. Use at your own risk.

## Requirements

- A **Nuki Opener** connected to your door intercom, set up in the Nuki app, **with a Nuki Bridge**
  (the Opener talks to the Nuki cloud through the Bridge).
- A [Nuki Web](https://web.nuki.io) account (the one your Opener is registered with).
- A free [Cloudflare](https://dash.cloudflare.com/sign-up) account. A custom domain is optional.
- Node.js 20 or newer.

## Setup

### 1. Get a Nuki API token and the device ID

1. Open [web.nuki.io](https://web.nuki.io) → **API** → generate an API token.
   Allow it to **read smartlocks** and to **execute smartlock actions**.
2. Install and list your devices to find the Opener's ID (type `Opener`):

   ```bash
   git clone https://github.com/Gimtiese/nuki-opener-link.git
   cd nuki-opener-link
   npm install
   NUKI_API_TOKEN=your-token npm run smartlocks
   ```

   Output example: `123456789	Opener	Front door`.

### 2. Configure (optional)

Copy `.env.example` to `.env` to set a title, a language and phone numbers shown to visitors
when something goes wrong. These values are embedded into the public page at build time,
so never put secrets in `.env`.

```bash
cp .env.example .env
```

For a custom domain, uncomment `routes` in [`wrangler.jsonc`](wrangler.jsonc) and enter your hostname.
The DNS zone has to be in the same Cloudflare account. Without it, the page is served on a
`*.workers.dev` address.

### 3. Deploy

```bash
npx wrangler login
npm run deploy
```

Then set the three secrets (each command asks for the value and does not echo it).
Here is where each value comes from:

| Secret | Where to get it |
| --- | --- |
| `NUKI_API_TOKEN` | [web.nuki.io](https://web.nuki.io) → **API** → generate a token with permission to read smartlocks and execute actions (step 1). Copy it right away; it is shown only once. |
| `NUKI_SMARTLOCK_ID` | Run `NUKI_API_TOKEN=your-token npm run smartlocks` and copy the first column of the line that says `Opener`. |
| `ACCESS_PIN` | You choose it, at least 5 characters (6 or more is better). To generate a random 8-digit PIN: `node -e "const c=require('node:crypto');console.log(String(c.randomInt(0,1e8)).padStart(8,'0'))"` |

When a command prompts `Enter a secret value:`, paste the value and press Enter.

```bash
npx wrangler secret put NUKI_API_TOKEN
npx wrangler secret put NUKI_SMARTLOCK_ID
npx wrangler secret put ACCESS_PIN
```

`ACCESS_PIN` must have **at least 5 characters** (6 or more is better); digits only are recommended, since
the phone shows a numeric keypad. Until all secrets are set, the API answers with `503 not_configured`.

### 4. Try it

Open your page, enter the PIN, tap **Open door**. The buzzer of your Opener should sound.
If nothing happens, see [Troubleshooting](#troubleshooting).

## Handing it out

Share the address and the PIN. To save visitors from typing, send a link with the PIN in the
fragment:

```
https://door.example.com/#pin=123456
```

The fragment is never sent to a server and is removed from the address bar right away; the
page remembers the PIN on that device. Be aware that the full link lives on in chat
histories and previews.

To **change or revoke access**, set a new PIN: `npx wrangler secret put ACCESS_PIN`.
Devices with the old PIN are asked for the new one on their next attempt.

## Configuration reference

| What | Where | Notes |
| --- | --- | --- |
| `NUKI_API_TOKEN` | Worker secret | Nuki Web API token |
| `NUKI_SMARTLOCK_ID` | Worker secret | From `npm run smartlocks` |
| `ACCESS_PIN` | Worker secret | At least 5 characters |
| `NUKI_ACTION` | Worker var (optional) | Default `3`: Opener buzzer. On a Smart Lock `3` is *unlatch* (other values: 1 unlock, 2 lock, 4 lock'n'go, 5 lock'n'go with unlatch). Uncomment `vars` in `wrangler.jsonc` to change it |
| `RATE_LIMITER` | `ratelimits` in `wrangler.jsonc` | Default: 10 requests / minute / IP |
| `VITE_SITE_TITLE` | `.env` (build time) | Heading and browser title |
| `VITE_CONTACTS` | `.env` (build time) | JSON array `[{"label":"Anna","phone":"+49 160 1234567"}]` |
| `VITE_LOCALE` | `.env` (build time) | `auto` (default), `en` or `de` |

## Local development

```bash
cp .dev.vars.example .dev.vars   # use test values; the file is git-ignored
npm run preview                  # build + Worker + assets on http://localhost:8787
```

With a fake `NUKI_API_TOKEN` the full flow runs and ends in `502 nuki_unreachable`,
without opening anything. For frontend work use `npm run dev:worker` and `npm run dev`
(Vite proxies `/api` to the Worker). Run all checks with `npm run check`
(type check, unit tests, build).

## Security

This page lets anyone who knows the PIN open your entrance. The design limits the risk,
but you decide whether it fits your situation.

- The Opener only triggers the **door buzzer** (typically the building entrance). It does not unlock your apartment door.
- The Nuki token and the PIN exist only as Worker secrets, never in the page.
- The PIN is compared in constant time. Requests are limited per IP (10/min by default), which slows guessing down: a 5-digit PIN has 100,000 combinations, so a single IP address needs about a week, a distributed attacker much less. **Prefer a longer, random PIN (8 digits or more)** and rotate it if it leaks.
- Every request needs a same-origin `Origin` header (when sent) and the correct PIN; wrong or malformed requests never reach the Nuki API.
- The page is served with a strict Content-Security-Policy, no framing, no referrer and `noindex`.
- The remembered PIN sits in the browser's `localStorage` on the visitor's device. Do not hand the PIN to people you do not trust with the door.
- The Nuki API accepts the command but does not confirm that the Opener executed it. If the Bridge is offline, the page may report success although nothing happened.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "The door could not be opened right now" and `Nuki API rejected the request: HTTP 401/403` in `npx wrangler tail` | Token invalid or missing the permission to execute actions |
| Same, with HTTP 400 or 404 | Wrong `NUKI_SMARTLOCK_ID`: use the number from `npm run smartlocks`, not the device ID printed in the app, and make sure the token belongs to the account the Opener is registered with |
| Same, with HTTP 5xx or timeouts | Nuki cloud outage; the Worker already retried 3 times |
| Page says success but the buzzer is silent | Bridge or Opener offline or out of Bluetooth range; check the device in the Nuki app |
| `503 not_configured` | A secret is missing, `ACCESS_PIN` is shorter than 5 characters, or `NUKI_ACTION` is not 1-5 |
| "Too many attempts" | Rate limit hit; wait a minute |
| `ratelimits` rejected on deploy | Remove the `ratelimits` block (the Worker then runs without rate limiting; use a long PIN) |

Live logs: `npx wrangler tail`.

## Project layout

```
worker/index.ts      Worker: PIN check, rate limit, Nuki API call
worker/index.test.ts Worker unit tests
src/                 Vue 3 frontend (App.vue, i18n, API client, config)
public/_headers      Security headers for the static assets
scripts/             Helper to list your Nuki devices
wrangler.jsonc       Cloudflare configuration
```

## Contributing

Issues and pull requests are welcome. Run `npm run check` before you open a PR.

## License

[MIT](LICENSE)
