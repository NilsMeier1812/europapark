import { RIDES, LANDS } from "./rides.js";

export const QUEUE_TIMES_URL = "https://queue-times.com/parks/51/queue_times.json";

/** Nach einem Alarm frühestens nach dieser Zeit erneut für dieselbe Bahn benachrichtigen. */
export const ALERT_COOLDOWN_MS = 20 * 60 * 1000;

/**
 * Wandelt die Antwort von queue-times.com in eine flache Liste um.
 * `t` ist der Zeitpunkt der letzten Aktualisierung bei queue-times (nicht unser Abrufzeitpunkt),
 * damit doppelte Abrufe derselben Daten keine doppelten History-Punkte erzeugen.
 */
export function parseQueueTimes(json) {
  const rides = [];
  const add = (land, r) =>
    rides.push({
      id: r.id,
      land: LANDS[land] ?? land,
      name: RIDES[r.id]?.name ?? r.name,
      open: Boolean(r.is_open),
      wait: Number(r.wait_time) || 0,
    });
  for (const land of json.lands ?? []) for (const r of land.rides ?? []) add(land.name, r);
  for (const r of json.rides ?? []) add("Sonstiges", r);

  let t = 0;
  for (const land of json.lands ?? []) for (const r of land.rides ?? []) t = Math.max(t, Date.parse(r.last_updated) || 0);
  for (const r of json.rides ?? []) t = Math.max(t, Date.parse(r.last_updated) || 0);

  return { t: t || Date.now(), rides };
}

/** Ergänzt Stammdaten (Koordinaten, Single Rider, „gute“ Wartezeit). */
export function enrich(ride) {
  const meta = RIDES[ride.id] ?? {};
  return {
    ...ride,
    lat: meta.lat ?? null,
    lon: meta.lon ?? null,
    good: meta.good ?? 10,
    sr: Boolean(meta.sr),
    virtual: Boolean(meta.virtual) || ride.name.startsWith("VirtualLine"),
  };
}

/**
 * Entscheidet, ob für einen Alarm eine Nachricht verschickt wird.
 * Es wird nur beim *Unterschreiten* der Schwelle benachrichtigt – nicht alle 5 Minuten erneut.
 * Erst wenn die Wartezeit wieder darüber liegt (oder die Bahn zu war), ist der Alarm wieder scharf.
 */
export function evaluateAlert(alert, ride, now) {
  const reached = Boolean(ride && ride.open && ride.wait <= alert.max);
  const send = reached && !alert.satisfied && now - (alert.lastSent || 0) >= ALERT_COOLDOWN_MS;
  return { reached, send };
}

/** Prüft die Eingaben vom Handy, bevor sie gespeichert werden. */
export function validateDevice(body) {
  if (!body || typeof body !== "object") throw new Error("Ungültige Daten");
  const alerts = {};
  for (const [id, max] of Object.entries(body.alerts ?? {}).slice(0, 60)) {
    const rideId = Number(id);
    const minutes = Math.round(Number(max));
    if (!Number.isInteger(rideId) || !Number.isFinite(minutes) || minutes < 0 || minutes > 300) continue;
    alerts[rideId] = minutes;
  }
  let subscription = null;
  const s = body.subscription;
  if (s) {
    if (typeof s.endpoint !== "string" || !s.endpoint.startsWith("https://") || s.endpoint.length > 1000)
      throw new Error("Ungültiges Push-Abo");
    if (typeof s.keys?.p256dh !== "string" || typeof s.keys?.auth !== "string") throw new Error("Ungültiges Push-Abo");
    subscription = { endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } };
  }
  return { alerts, subscription };
}
