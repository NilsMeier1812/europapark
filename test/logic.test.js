import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQueueTimes, enrich, evaluateAlert, validateDevice, ALERT_COOLDOWN_MS } from "../src/logic.js";

const sample = {
  lands: [
    { name: "Iceland", rides: [{ id: 5602, name: "WODAN - Timburcoaster", is_open: true, wait_time: 35, last_updated: "2026-07-01T10:05:03.000Z" }] },
    { name: "Atlantis", rides: [{ id: 999999, name: "Neue Bahn", is_open: false, wait_time: 0, last_updated: "2026-07-01T10:00:00.000Z" }] },
  ],
  rides: [],
};

test("parseQueueTimes übersetzt Namen/Bereiche und nimmt den Datenzeitpunkt", () => {
  const s = parseQueueTimes(sample);
  assert.equal(s.t, Date.parse("2026-07-01T10:05:03.000Z"));
  assert.deepEqual(s.rides[0], { id: 5602, land: "Island", name: "WODAN – Timburcoaster", open: true, wait: 35 });
  // unbekannte Bahn/Bereich bleibt mit Originalnamen erhalten
  assert.equal(s.rides[1].name, "Neue Bahn");
  assert.equal(s.rides[1].land, "Atlantis");
});

test("enrich ergänzt Koordinaten und Single Rider", () => {
  const [wodan, unknown] = parseQueueTimes(sample).rides.map(enrich);
  assert.equal(wodan.sr, true);
  assert.ok(wodan.lat > 48 && wodan.lon > 7);
  assert.equal(unknown.lat, null);
});

test("Alarm feuert einmal beim Unterschreiten, nicht dauerhaft", () => {
  const ride = { id: 1, open: true, wait: 15 };
  const t0 = 1_000_000_000;
  let a = { max: 20, satisfied: 0, lastSent: 0 };

  let r = evaluateAlert(a, ride, t0);
  assert.deepEqual(r, { reached: true, send: true });
  a = { ...a, satisfied: 1, lastSent: t0 };

  // 5 Minuten später, immer noch niedrig → keine zweite Nachricht
  r = evaluateAlert(a, ride, t0 + 5 * 60_000);
  assert.deepEqual(r, { reached: true, send: false });

  // steigt wieder → Alarm wird scharf
  r = evaluateAlert(a, { ...ride, wait: 40 }, t0 + 10 * 60_000);
  assert.equal(r.reached, false);
  a = { ...a, satisfied: 0 };

  // fällt kurz danach wieder → Cooldown verhindert Spam
  r = evaluateAlert(a, ride, t0 + 15 * 60_000);
  assert.equal(r.send, false);

  // nach dem Cooldown wieder erlaubt
  r = evaluateAlert(a, ride, t0 + ALERT_COOLDOWN_MS + 1);
  assert.equal(r.send, true);
});

test("Geschlossene Bahn löst keinen Alarm aus", () => {
  assert.equal(evaluateAlert({ max: 20, satisfied: 0, lastSent: 0 }, { open: false, wait: 0 }, Date.now()).send, false);
  assert.equal(evaluateAlert({ max: 20, satisfied: 0, lastSent: 0 }, undefined, Date.now()).send, false);
});

test("validateDevice filtert Unsinn", () => {
  const v = validateDevice({ alerts: { 5602: "20", abc: 5, 5604: -3, 5605: 1e9 }, subscription: null });
  assert.deepEqual(v.alerts, { 5602: 20 });
  assert.throws(() => validateDevice({ subscription: { endpoint: "http://evil", keys: { p256dh: "a", auth: "b" } } }));
});
