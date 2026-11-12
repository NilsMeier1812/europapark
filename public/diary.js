// Fahrten-Tagebuch: zählt, welche Bahnen ihr wie oft gefahren seid (ohne Wartezeit-Messung).
// Reine Funktionen ohne DOM – werden von app.js benutzt und in test/diary.test.js getestet.

/** So nah (Meter) muss man an einer Bahn sein, damit „Bei …? ✓ Gefahren“ vorgeschlagen wird. */
export const NEAR_M = 60;
/** Schlechtere GPS-Genauigkeit (Meter) → lieber nichts vorschlagen. */
export const MAX_ACCURACY_M = 75;
/** Nach „Gefahren“ bzw. „✕“ wird dieselbe Bahn so lange nicht nochmal vorgeschlagen. */
export const SNOOZE_AFTER_LOG_MS = 5 * 60_000; // kurz – zweimal hintereinander fahren ist normal
export const SNOOZE_AFTER_DISMISS_MS = 30 * 60_000;

const BERLIN_DATE = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });
export const berlinDay = (t = Date.now()) => BERLIN_DATE.format(new Date(t));

/** Neuer Eintrag. Der Name wird mitgespeichert, damit das Archiv auch in Jahren noch lesbar ist. */
export function addEntry(log, ride, t = Date.now()) {
  return [...log, { id: ride.id, n: ride.name, t }];
}

export function removeEntry(log, t) {
  return log.filter((e) => e.t !== t);
}

/** Zeitpunkt der letzten Fahrt auf dieser Bahn heute (oder null). */
export function lastRide(log, id, day = berlinDay()) {
  let last = null;
  for (const e of log) if (e.id === id && berlinDay(e.t) === day && (last === null || e.t > last)) last = e.t;
  return last;
}

/** Map rideId → Anzahl Fahrten an einem Tag */
export function countsForDay(log, day = berlinDay()) {
  const counts = new Map();
  for (const e of log) if (berlinDay(e.t) === day) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  return counts;
}

/** Bahnen in der Nähe, die als „gerade gefahren“ vorgeschlagen werden (nächste zuerst, max. 2). */
export function suggestions(rides, pos, distanceFn, snoozed = {}, now = Date.now()) {
  if (!pos || pos.accuracy > MAX_ACCURACY_M) return [];
  const seen = new Set();
  return rides
    .filter((r) => r.open && !r.virtual && r.lat != null && !(snoozed[r.id] > now))
    .map((r) => ({ ride: r, dist: distanceFn(pos, r) }))
    .filter((x) => x.dist <= NEAR_M)
    .sort((a, b) => a.dist - b.dist)
    .filter(({ ride }) => {
      const key = `${ride.lat},${ride.lon}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 2)
    .map((x) => x.ride);
}

/** Zusammenfassung eines Tages für die Bilanz. */
export function summary(log, day = berlinDay()) {
  const entries = log.filter((e) => berlinDay(e.t) === day).sort((a, b) => a.t - b.t);
  const byRide = new Map();
  for (const e of entries) {
    const cur = byRide.get(e.id) ?? { id: e.id, name: e.n, n: 0 };
    cur.n++;
    byRide.set(e.id, cur);
  }
  const top = [...byRide.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de"));
  return {
    day,
    count: entries.length,
    distinct: byRide.size,
    top,
    entries,
    first: entries[0]?.t ?? null,
    last: entries.at(-1)?.t ?? null,
  };
}

/** Alle Tage außer heute, neueste zuerst – fürs Archiv. */
export function pastDays(log, today = berlinDay()) {
  const days = [...new Set(log.map((e) => berlinDay(e.t)))].filter((d) => d !== today);
  return days.sort().reverse().map((d) => summary(log, d));
}

/**
 * Zeitpunkt für eine nachgetragene Fahrt aus Datum ("YYYY-MM-DD") und Uhrzeit ("HH:MM") in Handy-Ortszeit.
 * Wirft einen Fehler bei ungültigen Angaben oder Zeitpunkten in der Zukunft.
 */
export function backfillTime(date, time, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") || !/^\d{2}:\d{2}$/.test(time ?? "")) throw new Error("Bitte Tag und Uhrzeit angeben");
  const t = new Date(`${date}T${time}:00`).getTime();
  if (!Number.isFinite(t)) throw new Error("Ungültiges Datum");
  if (t > now + 60_000) throw new Error("Die Fahrt liegt in der Zukunft");
  return t;
}
