# EP Wartezeiten 🎢

Handy-Web-App für den Europa-Park: Live-Wartezeiten, Karte mit Laufweg, Verlauf des Tages und
**Push-Alarme**, wenn eine Bahn unter deine Wunsch-Wartezeit fällt – auch bei geschlossener App.

Alles läuft in **einem einzigen kostenlosen Cloudflare Worker**: Website, API, Cronjob alle 5 Minuten,
Datenbank und Push-Versand. Keine Firebase, kein Vercel, kein GitHub-Actions-Cronjob, keine API-Keys.

---

## 🚀 Hochfahren (einmalig, ca. 5 Minuten)

### Variante A – ohne Terminal, alles im Browser (empfohlen)

1. Kostenloses Konto auf <https://dash.cloudflare.com/sign-up> anlegen.
2. Im Dashboard: **Workers & Pages → Create → Import a repository**.
3. GitHub verbinden und dieses Repo (`europapark`) auswählen, Branch **main**.
4. Alles auf den Standardwerten lassen (Deploy command: `npx wrangler deploy`) → **Deploy**.
5. Fertig. Du bekommst eine Adresse wie `https://europapark.DEINNAME.workers.dev`.

Ab jetzt wird bei jedem Push auf `main` automatisch neu deployt.

### Variante B – per Terminal

Voraussetzung: [Node.js](https://nodejs.org) (Version 20 oder neuer).

```bash
npm install
npx wrangler login     # öffnet den Browser zum Anmelden bei Cloudflare
npm run deploy
```

### Danach auf dem Handy

1. Adresse im Handy öffnen.
2. **iPhone:** Teilen-Symbol → **„Zum Home-Bildschirm“**, dann die App *vom Home-Bildschirm* öffnen
   (Apple erlaubt Push nur so). **Android:** Menü → „App installieren“ (optional).
3. ⚙️ → **Push aktivieren** → erlauben → **Test-Push senden**. Kommt die Nachricht an, ist alles bereit.
4. Bei einer Bahn auf 🔔 tippen und die Wunsch-Wartezeit einstellen.

Jedes Familienmitglied macht das auf dem eigenen Handy – Alarme sind pro Gerät.

---

## 🧭 Was die App kann

| Funktion | Details |
|---|---|
| Live-Wartezeiten | von [Queue-Times.com](https://queue-times.com/parks/51), Server holt sie alle 5 Min |
| Sortierung | nach Bereich, kürzeste Wartezeit oder nächste Bahn (Standort) |
| Mini-Verlauf | Linie des heutigen Tages, grün = sinkt, rot = steigt, dazu „heute min–max“ |
| „Gute Zeit“ | Wartezeit liegt unter dem üblichen Wert der Bahn (in `src/rides.js` einstellbar) |
| Karte | alle Bahnen mit Wartezeit, eigener Standort, „Hinlaufen“-Link zu Google Maps |
| Favoriten ★ | Filter „Favoriten“ blendet alles andere aus |
| Push-Alarme 🔔 | einmal beim Unterschreiten der Grenze – kein Spam alle 5 Minuten, gelten bis Tagesende |
| Fahrten-Tagebuch 📒 | ✓ an jeder Bahn zählt eine Fahrt. Steht man an einer Bahn, schlägt die App sie oben vor („📍 Bei WODAN? ✓ Gefahren“). Nach 5 Min kommt der Vorschlag wieder – dann mit „zuletzt 12:20 Uhr“ und „✓ Nochmal“. Tagesbilanz, Favoriten noch offen, Archiv früherer Besuche |
| Offline | bei Funkloch startet die App mit dem letzten Stand |

Das Tagebuch wird nur auf dem jeweiligen Handy gespeichert (nicht auf dem Server).
Wer die App löscht oder die Websitedaten leert, verliert es.

**Warum nicht vollautomatisch per GPS?** Web-Apps bekommen den Standort nur, solange sie geöffnet sind –
mit dem Handy in der Tasche gibt es keine Daten. Außerdem liegen viele Bahnen dicht beieinander und in
Hallen gibt es kein GPS. Deshalb schlägt die App nur vor, und ein Tipp bestätigt.

---

## 🗂️ Aufbau

```
public/            Website (wird 1:1 ausgeliefert)
  index.html       Gerüst
  app.js           komplette App-Logik im Browser
  diary.js         Fahrten-Tagebuch (Zählen, Vorschlag „Bei …?“, Tagesbilanz)
  style.css        Aussehen
  sw.js            Service Worker – zeigt Push-Nachrichten an
src/
  worker.js        Server: API, Cronjob, Datenbank (Durable Object mit SQLite)
  logic.js         Daten umwandeln, Alarm-Regeln
  rides.js         ✏️ Bahn-Stammdaten: deutsche Namen, Koordinaten, „gute“ Wartezeit, Single Rider
  webpush.js       Push-Versand (Web-Push-Standard, ohne Zusatzpakete)
test/              automatische Tests (`npm test`)
wrangler.jsonc     Cloudflare-Konfiguration (inkl. Cron-Zeitplan)
```

**API** (vom Frontend genutzt):

- `GET /api/waits` – aktuelle Wartezeiten + Verlauf der letzten 12 h
- `GET /api/push-key` – öffentlicher Push-Schlüssel (wird beim ersten Aufruf automatisch erzeugt)
- `PUT /api/devices/:id` – Push-Abo + Alarme eines Handys speichern
- `POST /api/devices/:id/test` – Test-Push
- `DELETE /api/devices/:id` – Gerät löschen

---

## 🛠️ Lokal entwickeln

```bash
npm install
npm run dev        # http://localhost:8787
npm test           # Tests
```

Den Cronjob lokal auslösen: `npx wrangler dev --test-scheduled`, dann
`curl "http://localhost:8787/__scheduled?cron=1+*+*+*+*"`.

Zum Testen mit erfundenen Daten (z. B. wenn der Park zu ist) kann die Datenquelle überschrieben werden:
`npx wrangler dev --var QUEUE_TIMES_URL:http://localhost:9999/qt.json`

**Logs** der laufenden App: Cloudflare-Dashboard → Workers → `europapark` → *Logs*, oder `npx wrangler tail`.

---

## ❓ Häufige Probleme

- **Keine Push-Nachricht auf dem iPhone:** App muss vom Home-Bildschirm geöffnet sein (nicht Safari),
  iOS 16.4 oder neuer, und unter *Einstellungen → Mitteilungen → EP Wartezeiten* erlaubt.
- **Neue Bahn fehlt auf der Karte:** in `src/rides.js` mit ihrer queue-times-ID eintragen
  (IDs siehe <https://queue-times.com/parks/51/queue_times.json>).
- **Alle Bahnen „geschlossen“:** Park ist zu – oder queue-times.com hat gerade Probleme.
- **Kosten:** Der Gratis-Plan von Cloudflare reicht bei weitem (100.000 Anfragen/Tag).

Daten: [Powered by Queue-Times.com](https://queue-times.com/) · Karte: © OpenStreetMap-Mitwirkende
