// Der komplette Server: liefert die Website aus (Ordner public/), stellt eine kleine API bereit,
// holt per Cronjob alle 5 Minuten die Wartezeiten und verschickt Push-Alarme.
//
// Alle Daten (Wartezeit-Verlauf, Push-Abos, Alarme) liegen in EINEM Durable Object („Park“)
// mit eingebauter SQLite-Datenbank. Keine externe Datenbank, keine API-Keys.

import { DurableObject } from "cloudflare:workers";
import { QUEUE_TIMES_URL, parseQueueTimes, enrich, evaluateAlert, validateDevice } from "./logic.js";
import { generateVapidKeys, sendPush } from "./webpush.js";

const MAX_AGE_MS = 3 * 60 * 1000; // ältere Daten werden beim Öffnen der App neu geholt
const HISTORY_KEEP_MS = 16 * 60 * 60 * 1000;
const HISTORY_SEND_MS = 12 * 60 * 60 * 1000;
const MAX_DEVICES = 300;

export class Park extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history (t INTEGER PRIMARY KEY, waits TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, endpoint TEXT, p256dh TEXT, auth TEXT, updated INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS alerts (
        device_id TEXT NOT NULL, ride_id INTEGER NOT NULL, max INTEGER NOT NULL,
        satisfied INTEGER NOT NULL DEFAULT 0, last_sent INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (device_id, ride_id)
      );
    `);
    this.refreshing = null;
  }

  getKV(key) {
    const row = this.sql.exec("SELECT value FROM kv WHERE key = ?", key).toArray()[0];
    return row ? JSON.parse(row.value) : null;
  }

  setKV(key, value) {
    this.sql.exec("INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)", key, JSON.stringify(value));
  }

  /** Holt neue Wartezeiten (nie mehrere Abrufe gleichzeitig). */
  refresh() {
    this.refreshing ??= this.#doRefresh().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async #doRefresh() {
    // QUEUE_TIMES_URL lässt sich für Tests überschreiben (z. B. `wrangler dev --var QUEUE_TIMES_URL:…`)
    const res = await fetch(this.env.QUEUE_TIMES_URL || QUEUE_TIMES_URL, {
      headers: { "User-Agent": "europapark-wartezeiten (private Familien-App)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`queue-times.com antwortet mit ${res.status}`);
    const snap = parseQueueTimes(await res.json());
    snap.fetched = Date.now();
    this.setKV("snapshot", snap);

    if (snap.rides.some((r) => r.open)) {
      const waits = Object.fromEntries(snap.rides.map((r) => [r.id, r.open ? r.wait : null]));
      this.sql.exec("INSERT OR REPLACE INTO history (t, waits) VALUES (?, ?)", snap.t, JSON.stringify(waits));
    }
    this.sql.exec("DELETE FROM history WHERE t < ?", Date.now() - HISTORY_KEEP_MS);

    await this.#checkAlerts(snap);
    return snap;
  }

  async #checkAlerts(snap) {
    const rides = new Map(snap.rides.map((r) => [r.id, r]));
    const now = Date.now();
    const rows = this.sql
      .exec(
        `SELECT a.*, d.endpoint, d.p256dh, d.auth FROM alerts a
         JOIN devices d ON d.id = a.device_id WHERE d.endpoint IS NOT NULL`,
      )
      .toArray();

    const sends = [];
    for (const row of rows) {
      const ride = rides.get(row.ride_id);
      const { reached, send } = evaluateAlert({ max: row.max, satisfied: row.satisfied, lastSent: row.last_sent }, ride, now);
      this.sql.exec(
        "UPDATE alerts SET satisfied = ?, last_sent = ? WHERE device_id = ? AND ride_id = ?",
        reached ? 1 : 0,
        send ? now : row.last_sent,
        row.device_id,
        row.ride_id,
      );
      if (send) {
        sends.push(
          this.#push(row, {
            title: `🎢 ${ride.name}: ${ride.wait} Min`,
            body: `Jetzt nur ${ride.wait} Minuten Wartezeit (dein Alarm: ≤ ${row.max} Min).`,
            tag: `ride-${ride.id}`,
          }),
        );
      }
    }
    await Promise.allSettled(sends);
  }

  async #vapid() {
    let vapid = this.getKV("vapid");
    if (!vapid) {
      vapid = await generateVapidKeys();
      this.setKV("vapid", vapid);
    }
    return vapid;
  }

  async #push(device, data) {
    const subject = this.getKV("origin") ?? "mailto:wartezeiten@example.org";
    const status = await sendPush(
      { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
      data,
      await this.#vapid(),
      subject,
    );
    if (status === 404 || status === 410) {
      // Abo wurde auf dem Handy beendet – aufräumen
      this.sql.exec("UPDATE devices SET endpoint = NULL WHERE endpoint = ?", device.endpoint);
    }
    return status;
  }

  // ---------- Methoden, die vom Worker (per RPC) aufgerufen werden ----------

  async poll() {
    await this.refresh();
  }

  async getWaits() {
    let snap = this.getKV("snapshot");
    let error = null;
    if (!snap || Date.now() - snap.fetched > MAX_AGE_MS) {
      try {
        snap = await this.refresh();
      } catch (e) {
        error = e.message;
        if (!snap) throw e;
      }
    }
    const rows = this.sql.exec("SELECT t, waits FROM history WHERE t > ? ORDER BY t", Date.now() - HISTORY_SEND_MS).toArray();
    return {
      updated: snap.t,
      fetched: snap.fetched,
      error,
      rides: snap.rides.map(enrich),
      history: { t: rows.map((r) => r.t), waits: rows.map((r) => JSON.parse(r.waits)) },
    };
  }

  async getPublicKey() {
    return (await this.#vapid()).publicKey;
  }

  async saveDevice(id, body, origin) {
    const { alerts, subscription } = validateDevice(body);
    const exists = this.sql.exec("SELECT 1 FROM devices WHERE id = ?", id).toArray().length > 0;
    if (!exists && this.sql.exec("SELECT COUNT(*) AS n FROM devices").one().n >= MAX_DEVICES) {
      throw new Error("Zu viele Geräte registriert");
    }
    if (origin?.startsWith("https://")) this.setKV("origin", origin);

    this.sql.exec(
      `INSERT INTO devices (id, endpoint, p256dh, auth, updated) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh,
         auth = excluded.auth, updated = excluded.updated`,
      id,
      subscription?.endpoint ?? null,
      subscription?.keys.p256dh ?? null,
      subscription?.keys.auth ?? null,
      Date.now(),
    );

    const existing = new Map(
      this.sql.exec("SELECT ride_id, max FROM alerts WHERE device_id = ?", id).toArray().map((r) => [r.ride_id, r.max]),
    );
    for (const rideId of existing.keys()) {
      if (!(rideId in alerts)) this.sql.exec("DELETE FROM alerts WHERE device_id = ? AND ride_id = ?", id, rideId);
    }
    for (const [rideId, max] of Object.entries(alerts)) {
      if (existing.get(Number(rideId)) === max) continue; // unverändert → Status behalten
      this.sql.exec(
        `INSERT INTO alerts (device_id, ride_id, max, satisfied, last_sent) VALUES (?, ?, ?, 0, 0)
         ON CONFLICT(device_id, ride_id) DO UPDATE SET max = excluded.max, satisfied = 0, last_sent = 0`,
        id,
        Number(rideId),
        max,
      );
    }
    return { ok: true, alerts: Object.keys(alerts).length, push: Boolean(subscription) };
  }

  async deleteDevice(id) {
    this.sql.exec("DELETE FROM alerts WHERE device_id = ?", id);
    this.sql.exec("DELETE FROM devices WHERE id = ?", id);
    return { ok: true };
  }

  async testPush(id) {
    const device = this.sql.exec("SELECT * FROM devices WHERE id = ? AND endpoint IS NOT NULL", id).toArray()[0];
    if (!device) throw new Error("Für dieses Gerät sind keine Push-Nachrichten aktiviert");
    const status = await this.#push(device, {
      title: "Push funktioniert ✅",
      body: "So sehen deine Wartezeit-Alarme aus.",
      tag: "test",
    });
    if (status < 200 || status >= 300) throw new Error(`Push-Dienst antwortet mit Status ${status}`);
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const park = (env) => env.PARK.get(env.PARK.idFromName("europapark"));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      if (pathname === "/api/waits" && method === "GET") return json(await park(env).getWaits());
      if (pathname === "/api/push-key" && method === "GET") return json({ publicKey: await park(env).getPublicKey() });

      const m = pathname.match(/^\/api\/devices\/([A-Za-z0-9-]{8,64})(\/test)?$/);
      if (m) {
        const [, id, test] = m;
        if (test && method === "POST") return json(await park(env).testPush(id));
        if (!test && method === "PUT") return json(await park(env).saveDevice(id, await request.json(), url.origin));
        if (!test && method === "DELETE") return json(await park(env).deleteDevice(id));
      }
      if (pathname.startsWith("/api/")) return json({ error: "Nicht gefunden" }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: e.message }, 500);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(park(env).poll());
  },
};
