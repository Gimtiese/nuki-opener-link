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

## Einrichtung

### 1. Nuki-API-Token und Geräte-ID holen

1. Auf [web.nuki.io](https://web.nuki.io) → **API** einen API-Token erzeugen.
   Er braucht die Rechte, **Smartlocks zu lesen** und **Smartlock-Aktionen auszuführen**.
2. Projekt holen und die ID deines Openers (Typ `Opener`) auflisten:

   ```bash
   git clone https://github.com/Gimtiese/nuki-opener-link.git
   cd nuki-opener-link
   npm install
   NUKI_API_TOKEN=dein-token npm run smartlocks
   ```

### 2. Konfigurieren (optional)

`.env.example` nach `.env` kopieren, um Titel, Sprache und Telefonnummern zu setzen, die bei
Problemen angezeigt werden. Diese Werte landen beim Build in der öffentlichen Seite, **keine Secrets** eintragen.

```bash
cp .env.example .env
```

Für eine eigene Domain `routes` in [`wrangler.jsonc`](wrangler.jsonc) einkommentieren und den Hostnamen eintragen.
Die DNS-Zone muss im selben Cloudflare-Konto liegen. Ohne Eintrag läuft die Seite unter einer `*.workers.dev`-Adresse.

### 3. Deployen

```bash
npx wrangler login
npm run deploy
```

Danach die drei Secrets setzen (der Wert wird abgefragt und nicht angezeigt):

```bash
npx wrangler secret put NUKI_API_TOKEN
npx wrangler secret put NUKI_SMARTLOCK_ID
npx wrangler secret put ACCESS_PIN
```

`ACCESS_PIN` braucht **mindestens 6 Zeichen**, empfohlen sind nur Ziffern (am Handy erscheint ein Ziffernblock).
Solange ein Secret fehlt, antwortet die API mit `503 not_configured`.

### 4. Ausprobieren

Seite öffnen, PIN eingeben, **Tür öffnen** tippen. Der Summer des Openers sollte ertönen.
Bei Problemen siehe [Fehlersuche](#fehlersuche).

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
| `ACCESS_PIN` | Worker-Secret | mindestens 6 Zeichen |
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
- Der PIN wird in konstanter Zeit verglichen. Anfragen sind pro IP begrenzt (standardmäßig 10/Minute). Für einen einzelnen Angreifer macht das Raten eines 6-stelligen PINs unpraktikabel, für verteilte Angriffe nicht unmöglich. **Nimm einen langen, zufälligen PIN** und tausche ihn aus, falls er bekannt wird.
- Falsche oder fehlerhafte Anfragen erreichen die Nuki API nie.
- Die Seite wird mit strenger Content-Security-Policy, ohne Framing, ohne Referrer und mit `noindex` ausgeliefert.
- Der gemerkte PIN liegt im `localStorage` des Besuchergeräts. Gib den PIN nur Personen, denen du den Eingang anvertraust.
- Die Nuki API nimmt den Befehl an, bestätigt aber nicht, dass der Opener ihn ausgeführt hat. Ist die Bridge offline, kann die Seite Erfolg melden, obwohl nichts passiert ist.

Sicherheitslücke gefunden? Siehe [SECURITY.md](SECURITY.md).

## Fehlersuche

| Symptom | Wahrscheinliche Ursache |
| --- | --- |
| „Die Tür konnte gerade nicht geöffnet werden“ und `Nuki API rejected the request: HTTP 401/403` in `npx wrangler tail` | Token ungültig oder ohne Recht, Aktionen auszuführen |
| Dasselbe mit HTTP 404 | Falsche `NUKI_SMARTLOCK_ID` (mit `npm run smartlocks` prüfen) |
| Dasselbe mit HTTP 5xx oder Timeouts | Störung der Nuki-Cloud; der Worker hat schon 3-mal wiederholt |
| Seite meldet Erfolg, Summer bleibt still | Bridge oder Opener offline bzw. außer Bluetooth-Reichweite; Gerät in der Nuki-App prüfen |
| `503 not_configured` | Secret fehlt, `ACCESS_PIN` kürzer als 6 Zeichen oder `NUKI_ACTION` nicht 1-5 |
| „Zu viele Versuche“ | Rate-Limit erreicht, eine Minute warten |
| `ratelimits` beim Deploy abgelehnt | Block `ratelimits` entfernen (der Worker läuft dann ohne Rate-Limit; langen PIN nutzen) |

Live-Logs: `npx wrangler tail`.

## Mitmachen

Issues und Pull Requests sind willkommen. Vor einem PR bitte `npm run check` ausführen.

## Lizenz

[MIT](LICENSE)
