import { test } from "node:test";
import assert from "node:assert/strict";
import * as diary from "../public/diary.js";

const dist = (a, b) => {
  const R = 6371e3, rad = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const WODAN = { id: 5602, name: "WODAN", open: true, lat: 48.26136, lon: 7.71889 };
const BLUEFIRE = { id: 5603, name: "blue fire", open: true, lat: 48.26205, lon: 7.71934 };
const VL = { id: 1, name: "VirtualLine: X", open: true, virtual: true, lat: 48.26136, lon: 7.71889 };
const rides = [WODAN, BLUEFIRE, VL];

test("Vorschlag nur in der Nähe, bei offener Bahn und genauem GPS", () => {
  const atWodan = { lat: 48.2614, lon: 7.7189, accuracy: 15 };
  assert.deepEqual(diary.suggestions(rides, atWodan, dist).map((r) => r.id), [5602]);
  // ungenaues GPS → nichts
  assert.deepEqual(diary.suggestions(rides, { ...atWodan, accuracy: 200 }, dist), []);
  // weit weg → nichts
  assert.deepEqual(diary.suggestions(rides, { lat: 48.268, lon: 7.722, accuracy: 10 }, dist), []);
  // geschlossen → nichts
  assert.deepEqual(diary.suggestions([{ ...WODAN, open: false }], atWodan, dist), []);
  // VirtualLine nie
  assert.ok(!diary.suggestions(rides, atWodan, dist).some((r) => r.virtual));
});

test("Gesnoozte Bahn wird nicht vorgeschlagen", () => {
  const now = 1_000_000;
  const atWodan = { lat: 48.2614, lon: 7.7189, accuracy: 15 };
  assert.deepEqual(diary.suggestions(rides, atWodan, dist, { 5602: now + 1 }, now), []);
  assert.equal(diary.suggestions(rides, atWodan, dist, { 5602: now - 1 }, now).length, 1);
});

test("Zählen, Löschen und Tagesbilanz", () => {
  const day1 = Date.parse("2026-07-01T09:00:00Z");
  let log = [];
  log = diary.addEntry(log, WODAN, day1);
  log = diary.addEntry(log, WODAN, day1 + 3600_000);
  log = diary.addEntry(log, BLUEFIRE, day1 + 7200_000);
  const d = diary.berlinDay(day1);
  assert.equal(diary.countsForDay(log, d).get(5602), 2);

  const s = diary.summary(log, d);
  assert.equal(s.count, 3);
  assert.equal(s.distinct, 2);
  assert.deepEqual(s.top[0], { id: 5602, name: "WODAN", n: 2 });
  assert.equal(s.first, day1);

  log = diary.removeEntry(log, day1);
  assert.equal(diary.countsForDay(log, d).get(5602), 1);
});

test("Archiv: frühere Tage, neueste zuerst, ohne heute", () => {
  const log = [
    { id: 1, n: "A", t: Date.parse("2025-06-01T10:00:00Z") },
    { id: 1, n: "A", t: Date.parse("2026-07-01T10:00:00Z") },
    { id: 2, n: "B", t: Date.parse("2026-07-02T10:00:00Z") },
  ];
  const past = diary.pastDays(log, "2026-07-02");
  assert.deepEqual(past.map((p) => p.day), ["2026-07-01", "2025-06-01"]);
});
