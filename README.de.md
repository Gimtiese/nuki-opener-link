# Nuki Opener Link

*English documentation: [README.md](README.md)*

Eine Einseiten-Webseite mit einem Button, über die Lieferanten und Besuch den Türsummer öffnen
können. Sie löst über die Nuki Web API den Summer deines **[Nuki Opener](https://nuki.io/de/opener/)** aus.
Gebaut mit Vue 3 + TypeScript, kostenlos gehostet auf Cloudflare Workers.

- **Ein Tipp**: PIN, großer Button, fertig. Läuft auf jedem Handy, ohne App und ohne Konto für Besucher.
- **Dein Nuki-Token gelangt nie in den Browser.** Er liegt als Worker-Secret.
- **Gemeinsamer PIN** mit Rate-Limit pro IP und Vergleich in konstanter Zeit.
- **Zuverlässig**: automatische Wiederholungen gegenüber der Nuki API, klare Fehlermeldungen, Telefonnummern als Rückfall.
- **Kostenlos**: Cloudflare-Workers-Free-Plan (statische Dateien zählen nicht als Requests) und Nuki Web API.
- Deutsche und englische Oberfläche (nach Browsersprache), Dark Mode, strenge CSP, `noindex`.

> **Kein Nuki-Produkt, keine Verbindung zu Nuki.** „Nuki“ ist eine Marke der Nuki Home Solutions GmbH.
> Das Projekt öffnet eine Tür. Lies vor der Veröffentlichung den Abschnitt [Sicherheit](#sicherheit). Nutzung auf eigene Gefahr.

## Voraussetzungen

- Ein **Nuki Opener**, an deiner Türsprechanlage angeschlossen und in der Nuki-App eingerichtet, **mit Nuki Bridge**
  (der Opener erreicht die Nuki-Cloud über die Bridge).
- Ein [Nuki Web](https://web.nuki.io)-Konto (dasselbe wie in der App).
- Ein kostenloses [Cloudflare](https://dash.cloudflare.com/sign-up)-Konto, eine eigene Domain ist optional.
- Node.js 20 oder neuer.

## Schnellstart

```bash
git clone https://github.com/Gimtiese/nuki-opener-link.git
cd nuki-opener-link
npm install
npm run setup
```

Der Installer stellt ein paar Fragen und erledigt den Rest:

1. Meldet dich bei Cloudflare an (ein Browserfenster öffnet sich).
2. Fragt deinen Nuki-API-Token ab ([so erzeugst du ihn](#nuki-api-token)), prüft ihn und findet deinen Opener automatisch.
3. Erzeugt einen zufälligen PIN für Besucher (oder du wählst einen).
4. Fragt nach Sprache, Überschrift, Telefonnummern für Probleme und optional einer eigenen Domain.
5. Baut die Seite, veröffentlicht sie, lädt die Secrets hoch und testet, ob alles funktioniert. Auf Wunsch klingelt er sogar einmal den Summer.

Am Ende bekommst du die Adresse und einen Link mit vorausgefülltem PIN. Mit `npm run setup` änderst du die Einstellungen jederzeit.
Erst mal nur ansehen? `npm run setup -- --dry-run` stellt alle Fragen, ändert aber nichts.

### Nuki-API-Token

1. [web.nuki.io](https://web.nuki.io) öffnen und mit dem Account anmelden, bei dem dein Opener registriert ist.
2. Unter **API** einen Token erzeugen. Er braucht die Rechte, **Smartlocks zu lesen** und **Smartlock-Aktionen auszuführen**.
3. Sofort kopieren, er wird nur einmal angezeigt. Im Installer einfügen, die Eingabe bleibt unsichtbar.

Den Token nie in Befehle, Chats oder Dateien im Repo schreiben.

## Manuelle Einrichtung

Lieber von Hand? Das sind die Schritte, die `npm run setup` ausführt.

1. Token wie oben erzeugen und mit `npm run smartlocks` deine Geräte auflisten. Die erste Spalte der Zeile mit `Opener` ist die `NUKI_SMARTLOCK_ID`.
2. Optional: `cp .env.example .env` und bearbeiten (Titel, Sprache, Telefonnummern). Diese Werte landen beim Build in der öffentlichen Seite, **keine Secrets** eintragen.
3. Optional: Für eine eigene Domain in [`wrangler.jsonc`](wrangler.jsonc) die Zeile `routes` einkommentieren und den Hostnamen eintragen. Die DNS-Zone muss im selben Cloudflare-Konto liegen; ohne Eintrag läuft die Seite unter einer `*.workers.dev`-Adresse.
4. Deployen:

   ```bash
   npx wrangler login
   npm run deploy
   ```

5. Die drei Secrets setzen. Jeder Befehl fragt den Wert ab (bei `Enter a secret value:` einfügen):

   ```bash
   npx wrangler secret put NUKI_API_TOKEN
   npx wrangler secret put NUKI_SMARTLOCK_ID
   npx wrangler secret put ACCESS_PIN
   ```

   | Secret | Wert |
   | --- | --- |
   | `NUKI_API_TOKEN` | Der Token von oben |
   | `NUKI_SMARTLOCK_ID` | Die ID aus `npm run smartlocks` |
   | `ACCESS_PIN` | Wählst du selbst, mindestens 5 Zeichen (6 oder mehr ist besser). Zufälliger 8-stelliger PIN: `node -e "const c=require('node:crypto');console.log(String(c.randomInt(0,1e8)).padStart(8,'0'))"` |

   Solange nicht alle drei gesetzt sind, antwortet die API mit `503 not_configured`.

6. Seite öffnen, PIN eingeben, **Tür öffnen** tippen. Der Summer des Openers sollte ertönen. Wenn nicht, siehe [Fehlersuche](#fehlersuche).

## Weitergeben

Adresse und PIN weitergeben. Damit Besucher nichts tippen müssen, kannst du einen Link mit PIN im Fragment schicken:

```
https://haustuer.example.com/#pin=123456
```

Das Fragment wird nie an einen Server gesendet und sofort aus der Adresszeile entfernt; die Seite merkt sich den PIN auf dem Gerät.
Beachte, dass der komplette Link in Chatverläufen und Vorschauen erhalten bleibt.

**Zugang ändern oder entziehen**: neuen PIN setzen mit `npx wrangler secret put ACCESS_PIN`.
Geräte mit dem alten PIN werden beim nächsten Versuch nach dem neuen gefragt.

## Konfigurationsübersicht

| Was | Wo | Hinweis |
| --- | --- | --- |
| `NUKI_API_TOKEN` | Worker-Secret | Nuki-Web-API-Token |
| `NUKI_SMARTLOCK_ID` | Worker-Secret | aus `npm run smartlocks` |
| `ACCESS_PIN` | Worker-Secret | mindestens 5 Zeichen |
| `NUKI_ACTION` | Worker-Variable (optional) | Standard `3`: Opener-Summer. Beim Smart Lock bedeutet `3` *Falle öffnen* (1 entriegeln, 2 verriegeln, 4 Lock’n’Go, 5 Lock’n’Go mit Falle). In `wrangler.jsonc` unter `vars` einkommentieren |
| `RATE_LIMITER` | `ratelimits` in `wrangler.jsonc` | Standard: 10 Anfragen / Minute / IP |
| `VITE_SITE_TITLE` | `.env` (Build) | Überschrift und Browser-Titel |
| `VITE_CONTACTS` | `.env` (Build) | JSON-Array `[{"label":"Anna","phone":"+49 160 1234567"}]` |
| `VITE_LOCALE` | `.env` (Build) | `auto` (Standard), `en` oder `de` |

## Lokale Entwicklung

```bash
cp .dev.vars.example .dev.vars   # Testwerte verwenden, Datei ist git-ignoriert
npm run preview                  # Build + Worker + Assets auf http://localhost:8787
```

Mit einem Fake-`NUKI_API_TOKEN` läuft der ganze Ablauf bis `502 nuki_unreachable`, ohne etwas zu öffnen.
Für Frontend-Arbeit `npm run dev:worker` und `npm run dev` starten (Vite leitet `/api` an den Worker weiter).
Alle Prüfungen: `npm run check` (Typen, Tests, Build).

## Sicherheit

Wer den PIN kennt, kann deinen Eingang öffnen. Das Design begrenzt das Risiko, ob es zu deiner Situation passt, entscheidest du.

- Der Opener löst nur den **Türsummer** aus (meist Hauseingang), nicht deine Wohnungstür.
- Nuki-Token und PIN existieren nur als Worker-Secrets, nie in der Seite.
- Der PIN wird in konstanter Zeit verglichen. Anfragen sind pro IP begrenzt (standardmäßig 10/Minute). Das bremst das Raten: Ein 5-stelliger PIN hat 100.000 Kombinationen, eine einzelne IP braucht dafür etwa eine Woche, ein verteilter Angriff deutlich weniger. **Nimm besser einen längeren, zufälligen PIN (8 Ziffern oder mehr)** und tausche ihn aus, falls er bekannt wird.
- Falsche oder fehlerhafte Anfragen erreichen die Nuki API nie.
- Die Seite wird mit strenger Content-Security-Policy, ohne Framing, ohne Referrer und mit `noindex` ausgeliefert.
- Der gemerkte PIN liegt im `localStorage` des Besuchergeräts. Gib den PIN nur Personen, denen du den Eingang anvertraust.
- Die Nuki API nimmt den Befehl an, bestätigt aber nicht, dass der Opener ihn ausgeführt hat. Ist die Bridge offline, kann die Seite Erfolg melden, obwohl nichts passiert ist.

Sicherheitslücke gefunden? Siehe [SECURITY.md](SECURITY.md).

## Fehlersuche

| Symptom | Wahrscheinliche Ursache |
| --- | --- |
| „Die Tür konnte gerade nicht geöffnet werden“ und `Nuki API rejected the request: HTTP 401/403` in `npx wrangler tail` | Token ungültig oder ohne Recht, Aktionen auszuführen |
| Dasselbe mit HTTP 400 oder 404 | Falsche `NUKI_SMARTLOCK_ID`: die Nummer aus `npm run smartlocks` verwenden, nicht die in der App angezeigte Geräte-ID, und der Token muss zu dem Account gehören, bei dem der Opener registriert ist |
| Dasselbe mit HTTP 5xx oder Timeouts | Störung der Nuki-Cloud; der Worker hat schon 3-mal wiederholt |
| Seite meldet Erfolg, Summer bleibt still | Bridge oder Opener offline bzw. außer Bluetooth-Reichweite; Gerät in der Nuki-App prüfen |
| `503 not_configured` | Secret fehlt, `ACCESS_PIN` kürzer als 5 Zeichen oder `NUKI_ACTION` nicht 1-5 |
| „Zu viele Versuche“ | Rate-Limit erreicht, eine Minute warten |
| `ratelimits` beim Deploy abgelehnt | Block `ratelimits` entfernen (der Worker läuft dann ohne Rate-Limit; langen PIN nutzen) |

Live-Logs: `npx wrangler tail`.

## Mitmachen

Issues und Pull Requests sind willkommen. Vor einem PR bitte `npm run check` ausführen.

## Lizenz

[MIT](LICENSE)
