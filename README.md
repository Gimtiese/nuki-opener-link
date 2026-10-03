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

## Quick start

```bash
git clone https://github.com/Gimtiese/nuki-opener-link.git
cd nuki-opener-link
npm install
npm run setup
```

The installer asks a few questions and does the rest:

1. Logs you in to Cloudflare (a browser window opens).
2. Asks for your Nuki API token ([how to create it](#nuki-api-token)), checks it and finds your Opener automatically.
3. Creates a random PIN for visitors (or lets you choose one).
4. Asks for language, heading, phone numbers for problems and an optional custom domain.
5. Builds the page, deploys it, uploads the secrets and tests that everything works. It can even buzz the door once.

At the end you get the address and a link with the PIN pre-filled. Run `npm run setup` again any time to change settings.
Want to look first? `npm run setup -- --dry-run` asks all questions but changes nothing.

### Nuki API token

1. Open [web.nuki.io](https://web.nuki.io) and log in with the account your Opener is registered to.
2. Go to **API** and generate a token. Allow it to **read smartlocks** and to **execute smartlock actions**.
3. Copy it right away; it is shown only once. Paste it into the installer, which hides your input.

Never put the token into commands, chats or files in the repo.

## Manual setup

Prefer to do it by hand? These are the steps `npm run setup` performs.

1. Create the token as described above and run `npm run smartlocks` to list your devices. Copy the first column of the `Opener` line: that is `NUKI_SMARTLOCK_ID`.
2. Optional: `cp .env.example .env` and edit it (title, language, phone numbers). These values are embedded into the public page at build time, so never put secrets there.
3. Optional: for your own domain, uncomment the `routes` line in [`wrangler.jsonc`](wrangler.jsonc) and enter the hostname. The DNS zone must be in the same Cloudflare account; without it the page is served on a `*.workers.dev` address.
4. Deploy:

   ```bash
   npx wrangler login
   npm run deploy
   ```

5. Set the three secrets. Each command asks for the value (paste it when you see `Enter a secret value:`):

   ```bash
   npx wrangler secret put NUKI_API_TOKEN
   npx wrangler secret put NUKI_SMARTLOCK_ID
   npx wrangler secret put ACCESS_PIN
   ```

   | Secret | Value |
   | --- | --- |
   | `NUKI_API_TOKEN` | The token from above |
   | `NUKI_SMARTLOCK_ID` | The ID from `npm run smartlocks` |
   | `ACCESS_PIN` | You choose it, at least 5 characters (6 or more is better). A random 8-digit PIN: `node -e "const c=require('node:crypto');console.log(String(c.randomInt(0,1e8)).padStart(8,'0'))"` |

   Until all three are set, the API answers `503 not_configured`.

6. Open your page, enter the PIN and tap **Open door**. The buzzer of your Opener should sound. If not, see [Troubleshooting](#troubleshooting).

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
scripts/setup.mjs     Interactive installer (npm run setup)
scripts/lib.mjs       Shared helpers, list-smartlocks.mjs lists your Nuki devices
wrangler.jsonc       Cloudflare configuration
```

## Contributing

Issues and pull requests are welcome. Run `npm run check` before you open a PR.

## License

[MIT](LICENSE)
