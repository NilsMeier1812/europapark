// Minimaler Web-Push-Versand (RFC 8291 Verschlüsselung + RFC 8292 VAPID)
// nur mit WebCrypto – läuft in Cloudflare Workers und Node ≥ 20 ohne Zusatzpakete.

const enc = new TextEncoder();

export function b64urlEncode(bytes) {
  let s = "";
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/** Erzeugt ein neues VAPID-Schlüsselpaar (als JWK, damit es gespeichert werden kann). */
export async function generateVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { privateJwk, publicKey: b64urlEncode(publicRaw) };
}

async function vapidAuthHeader(endpoint, vapid, subject) {
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64urlEncode(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey("jwk", vapid.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${payload}`));
  return `vapid t=${header}.${payload}.${b64urlEncode(sig)}, k=${vapid.publicKey}`;
}

/** Verschlüsselt den Payload für ein Abo (Content-Encoding: aes128gcm). */
export async function encryptPayload(subscription, plaintext) {
  const uaPublic = b64urlDecode(subscription.keys.p256dh);
  const authSecret = b64urlDecode(subscription.keys.auth);

  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = concat(enc.encode(plaintext), new Uint8Array([2])); // 0x02 = letzter Record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded));

  const recordSize = new Uint8Array([0, 0, 16, 0]); // 4096
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/**
 * Schickt eine Push-Nachricht. Gibt den HTTP-Status zurück.
 * 404/410 bedeutet: Abo existiert nicht mehr und kann gelöscht werden.
 */
export async function sendPush(subscription, data, vapid, subject) {
  const body = await encryptPayload(subscription, JSON.stringify(data));
  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthHeader(subscription.endpoint, vapid, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "900", // nach 15 Min ist eine Wartezeit-Info wertlos
      Urgency: "high",
    },
    body,
  });
  if (!res.ok) console.log(`Push an ${new URL(subscription.endpoint).host} fehlgeschlagen: ${res.status} ${await res.text()}`);
  return res.status;
}
