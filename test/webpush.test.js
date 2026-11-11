import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { encryptPayload, generateVapidKeys, sendPush, b64urlEncode, b64urlDecode } from "../src/webpush.js";

// Simuliert den Browser: eigenes Schlüsselpaar + auth secret, Entschlüsselung unabhängig per node:crypto
function makeBrowser() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ecdh,
    auth,
    subscription: {
      endpoint: "https://push.example.com/abc",
      keys: { p256dh: b64urlEncode(ecdh.getPublicKey()), auth: b64urlEncode(auth) },
    },
  };
}

function decrypt(browser, body) {
  body = Buffer.from(body);
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const shared = browser.ecdh.computeSecret(asPublic);
  const info = Buffer.concat([Buffer.from("WebPush: info\0"), browser.ecdh.getPublicKey(), asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", shared, browser.auth, info, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "Padding-Delimiter fehlt");
  return plain.subarray(0, plain.length - 1).toString("utf8");
}

test("base64url round trip", () => {
  const bytes = crypto.randomBytes(65);
  assert.deepEqual(Buffer.from(b64urlDecode(b64urlEncode(bytes))), bytes);
});

test("Payload lässt sich vom Browser entschlüsseln", async () => {
  const browser = makeBrowser();
  const msg = JSON.stringify({ title: "🎢 Silver Star: 15 Min", body: "Umlaute äöü ß" });
  const body = await encryptPayload(browser.subscription, msg);
  assert.equal(decrypt(browser, body), msg);
});

test("sendPush schickt korrekte Header und gültige VAPID-Signatur", async () => {
  const browser = makeBrowser();
  const vapid = await generateVapidKeys();
  let captured;
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(null, { status: 201 });
  };
  try {
    const status = await sendPush(browser.subscription, { title: "Hallo" }, vapid, "https://ep.example.workers.dev");
    assert.equal(status, 201);
  } finally {
    globalThis.fetch = origFetch;
  }
  const h = captured.init.headers;
  assert.equal(h["Content-Encoding"], "aes128gcm");
  assert.ok(Number(h.TTL) > 0);
  assert.equal(JSON.parse(decrypt(browser, captured.init.body)).title, "Hallo");

  const m = h.Authorization.match(/^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/);
  assert.ok(m, "Authorization-Header hat falsches Format");
  const [, header, payload, sig, k] = m;
  assert.equal(k, vapid.publicKey);
  const claims = JSON.parse(Buffer.from(b64urlDecode(payload)).toString());
  assert.equal(claims.aud, "https://push.example.com");
  assert.equal(claims.sub, "https://ep.example.workers.dev");
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600);

  const pub = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: vapid.privateJwk.x, y: vapid.privateJwk.y }, format: "jwk" });
  const ok = crypto.verify("sha256", Buffer.from(`${header}.${payload}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(b64urlDecode(sig)));
  assert.ok(ok, "VAPID-Signatur ungültig");
});
