# Nuki Opener Link

[![CI](https://github.com/Gimtiese/nuki-opener-link/actions/workflows/ci.yml/badge.svg)](https://github.com/Gimtiese/nuki-opener-link/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

*Deutsche Anleitung: [README.de.md](README.de.md)*

A one-button web page that lets delivery people buzz open your door with a
**[Nuki Opener](https://nuki.io/en/opener/)**. Free to host on Cloudflare, set up with one command.

- **One tap for visitors**: PIN, big button, done. No app, no account.
- **Hardened**: brute-force guard that works worldwide, opening hours, optional Cloudflare Turnstile, strict security headers.
- **Simple to run**: `npm run setup` asks a few questions and does everything else.
- **Free**: Cloudflare Workers free plan, Nuki Web API, Turnstile.

```
Phone ──▶ Cloudflare Worker ──▶ Nuki Web API ──▶ Bridge ──▶ Opener ──▶ buzzer
          checks: rate limit · opening hours · Turnstile · PIN + brute-force guard
```

> **Not affiliated with Nuki.** "Nuki" is a trademark of Nuki Home Solutions GmbH.
> This project opens a door. Read [Security](#security) and use it at your own risk.

## Requirements

- A **Nuki Opener** connected to your intercom, set up in the Nuki app, **with a Nuki Bridge**.
- A [Nuki Web](https://web.nuki.io) login (the account your Opener is registered to).
- A free [Cloudflare account](https://dash.cloudflare.com/sign-up). Your own domain is optional.
- [Node.js](https://nodejs.org) 20 or newer and Git.

## Quick start

```bash
git clone https://github.com/Gimtiese/nuki-opener-link.git
cd nuki-opener-link
npm install
npm run setup
```

The installer takes about five minutes:

| Step | What happens |
| --- | --- |
| 1. Cloudflare | Opens the browser to log in (only the first time). |
| 2. Nuki | Asks for your [Nuki API token](#nuki-api-token) (hidden input), checks it and finds your Opener. |
| 3. PIN | Generates a random 8-digit PIN for visitors, or lets you choose one (at least 5 characters). |
| 4. Opening hours | Around the clock, daytime (06:00–22:00) or your own times. |
| 5. Page | Language, heading and phone numbers shown when something goes wrong. |
| 6. Address | Your own domain or a free `*.workers.dev` address, and Turnstile on or off. |
| 7. Publish | Creates the Turnstile widget, builds, deploys, uploads the secrets and checks that the page is live. |

At the end you get the address, a link with the PIN pre-filled and the PIN itself. Write it down.

To see the questions first without changing anything, run `npm run setup -- --dry-run`.

### Nuki API token

1. Log in at [web.nuki.io](https://web.nuki.io) with the account your Opener is registered to.
2. Open **API** and generate a token. Allow it to **read smartlocks** and to **execute smartlock actions**.
3. Copy it right away; it is shown only once. Paste it into the installer when asked.

Never put the token into a command line, a chat or a file in the repository.

## Everyday use

| Task | How |
| --- | --- |
| Give someone access | Send the address and the PIN, or the link `https://your-address/#pin=12345678`. The PIN in the link never reaches a server and is removed from the address bar. The page remembers it on that phone. |
| Change the PIN (revoke access) | `npx wrangler secret put ACCESS_PIN`. Takes effect at once; old PINs stop working. |
| Change hours, phone numbers, domain, Turnstile | Run `npm run setup` again. Current settings are pre-filled; Nuki access and PIN are kept unless you choose otherwise. |
| Watch what happens | `npx wrangler tail` shows live logs, including wrong PINs and locks. |
| Update to a new version | `git pull && npm install && npm run setup` |

## Security

No page that opens a door with a shared PIN can be 100 % secure: anyone who knows the PIN gets in.
The goal is that **guessing is practically impossible**, misuse is limited, and nothing leaks.

### Layers

| Layer | Protects against | Details |
| --- | --- | --- |
| Opening hours | Use at night | Outside the hours the door cannot be opened at all, not even with the right PIN. |
| Brute-force guard | Guessing the PIN, also from many IPs | One global [Durable Object](worker/guard.ts) sees every attempt worldwide. **Per client** (IPv4 address, IPv6 /64 network): locked after 5 wrong PINs, 1 minute, doubling up to 1 hour. **Globally**: 30 wrong PINs within an hour lock the door for everyone for 1 hour. While locked, even the correct PIN is refused, so a lock never reveals whether a guess was right. |
| Turnstile (optional) | Bots and scripts | Cloudflare checks invisibly that a human is using the page; usually no click needed. Failed checks never count as PIN attempts. |
| Rate limit | Request floods | 10 requests per minute per client before anything else runs. |
| Secrets | Leaking credentials | Nuki token, PIN and Turnstile secret exist only as Worker secrets, never in the page or the repository. The device and the action are fixed, so the API cannot be used for anything else. |
| Request checks | Cross-site requests, junk | Only `POST` with JSON, foreign origins refused, body capped at 4 KB, constant-time PIN comparison. |
| Headers | Injection, framing, downgrade | Strict Content-Security-Policy, HSTS, no framing, no referrer, `noindex`. |

With these limits, guessing a 5-digit PIN takes on average about two months of continuous attacking,
during which the door is locked about half of the time. An 8-digit PIN takes centuries. **Use 8 digits.**

### What you should know

- **A global lock can be triggered on purpose.** Someone who keeps guessing can lock the page for real visitors. Locks end on their own (at most 1 hour). For that case, the page shows your phone numbers.
- **The PIN spreads.** Delivery people may pass it on. Change it from time to time and whenever you suspect misuse.
- **The remembered PIN** sits in `localStorage` on the visitor's phone.
- **Nuki does not confirm execution.** If the Bridge is offline, the page may report success although nothing happened.
- **Turnstile needs Cloudflare.** If its script is blocked on a visitor's phone, that visitor cannot open the door and sees the phone numbers.

### Protect your accounts

The biggest real risk is not this code but your accounts:

- Turn on two-factor authentication for **Cloudflare** and **Nuki**.
- The Worker only needs the permission to **execute actions**. If you like, create a second Nuki token with only that permission after the setup and set it with `npx wrangler secret put NUKI_API_TOKEN`.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Configuration reference

The installer manages all of this. For manual changes:

| Setting | Where | Notes |
| --- | --- | --- |
| `NUKI_API_TOKEN` | Worker secret | Nuki Web API token |
| `NUKI_SMARTLOCK_ID` | Worker secret | Device ID from `npm run smartlocks` |
| `ACCESS_PIN` | Worker secret | At least 5 characters, 8 digits recommended |
| `TURNSTILE_SECRET_KEY` | Worker secret (optional) | Enables Turnstile; needs `VITE_TURNSTILE_SITE_KEY` |
| `OPEN_HOURS` | `vars` in `wrangler.jsonc` (optional) | `07:00-21:00`; several ranges with commas, over midnight like `22:00-06:00`. Empty = always |
| `TIMEZONE` | `vars` in `wrangler.jsonc` | IANA name like `Europe/Berlin`; required with `OPEN_HOURS` |
| `NUKI_ACTION` | `vars` in `wrangler.jsonc` (optional) | Default `3` = Opener buzzer. On a Smart Lock: 1 unlock, 2 lock, 3 unlatch |
| `routes` | `wrangler.jsonc` | Your own domain; turns the `workers.dev` address off |
| `VITE_TURNSTILE_SITE_KEY` | `.env` (build time) | Turnstile site key |
| `VITE_SITE_TITLE` | `.env` (build time) | Heading and browser title |
| `VITE_CONTACTS` | `.env` (build time) | `[{"label":"Anna","phone":"+49 160 1234567"}]` |
| `VITE_LOCALE` | `.env` (build time) | `auto` (default), `en` or `de` |

`.env` values become part of the public page, so never put secrets there. After editing `.env` or
`wrangler.jsonc`, run `npm run deploy`. Invalid settings make the API answer `503 not_configured`
and `npx wrangler tail` names the problem; the door never opens on a broken configuration.

<details>
<summary><strong>Manual setup without the installer</strong></summary>

1. Create the [Nuki API token](#nuki-api-token) and run `npm run smartlocks`. The first column of the `Opener` line is your device ID.
2. Optional: `cp .env.example .env` and edit it.
3. Optional: edit the block `managed by npm run setup` in [`wrangler.jsonc`](wrangler.jsonc) for domain and opening hours.
4. Deploy and set the secrets (each command asks for the value):

   ```bash
   npx wrangler login
   npm run deploy
   npx wrangler secret put NUKI_API_TOKEN
   npx wrangler secret put NUKI_SMARTLOCK_ID
   npx wrangler secret put ACCESS_PIN
   ```

5. Optional Turnstile: create a widget for your hostname in the [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/turnstile), put the site key into `.env` as `VITE_TURNSTILE_SITE_KEY`, run `npx wrangler secret put TURNSTILE_SECRET_KEY` with the secret key, then `npm run deploy`.

</details>

## Troubleshooting

Live logs: `npx wrangler tail`, then tap the button.

| Page or log says | Cause and fix |
| --- | --- |
| "The PIN is not correct" | Wrong PIN. Five wrong PINs lock that phone for a while. |
| "Too many wrong attempts …" | Locked by the brute-force guard. Wait the time shown (at most 1 hour). |
| "Only at these times …" | Outside the opening hours. Change them with `npm run setup`. |
| "The security check failed" | Turnstile could not confirm a human. Reload the page; on persistent problems run `npm run setup` (checks the widget's domain). |
| "Could not be opened right now" + `Nuki API rejected the request: HTTP 401/403` | Token invalid or without the action permission. |
| … + `HTTP 400` or `404` | Wrong device ID. Use the number from `npm run smartlocks`, and a token of the account the Opener belongs to. |
| … + `HTTP 5xx` or timeouts | Nuki cloud outage; the Worker already retried 3 times. |
| Success, but the buzzer stays silent | Bridge or Opener offline. Check the device in the Nuki app. |
| `503 not_configured` | A setting is missing or invalid; the log names it. Run `npm run setup`. |
| Deploy fails with a domain | The domain must be managed by Cloudflare in the same account. |

## Local development

```bash
cp .dev.vars.example .dev.vars   # test values, git-ignored
npm run preview                  # build and run the Worker on http://localhost:8787
```

With the fake token from the example, the whole flow runs and ends in `502 nuki_unreachable`
without opening anything. `.dev.vars.example` contains Cloudflare's official Turnstile **test**
secret; build with `VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run preview` to try Turnstile
locally. For frontend work run `npm run dev:worker` and `npm run dev` side by side.
`npm run check` runs type checks, all tests and the build.

## Project layout

```
worker/index.ts     API: checks in order, Nuki call
worker/guard.ts     brute-force guard (Durable Object)
shared/hours.js     opening hours, shared by Worker and installer
src/                Vue 3 page (App.vue, Turnstile, texts in en/de)
scripts/setup.mjs   interactive installer
public/_headers     security headers
wrangler.jsonc      Cloudflare configuration
```

## Contributing

Issues and pull requests are welcome. Please run `npm run check` before opening a pull request.

## License

[MIT](LICENSE)
