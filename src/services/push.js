import crypto from 'node:crypto';
import http2 from 'node:http2';
import { config } from '../config.js';

/**
 * Slanje push obavijesti preko Appleovog APNs-a.
 *
 * APNs traži HTTP/2 i JWT potpisan ES256 ključem (.p8) — oboje je u standardnoj
 * knjižnici Node-a, pa ovdje nema vanjskih ovisnosti.
 */
const HOST = () => (config.apns.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** APNs token vrijedi do 60 minuta; Apple odbija prečesto izdavanje novih. */
let cachedToken = { value: null, at: 0 };

export function providerToken(now = Date.now()) {
  if (cachedToken.value && now - cachedToken.at < 45 * 60 * 1000) return cachedToken.value;

  const header = b64url(JSON.stringify({ alg: 'ES256', kid: config.apns.keyId }));
  const payload = b64url(JSON.stringify({ iss: config.apns.teamId, iat: Math.floor(now / 1000) }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: config.apns.key,
    dsaEncoding: 'ieee-p1363', // APNs traži sirovi r||s zapis, ne DER
  });

  cachedToken = { value: `${header}.${payload}.${b64url(signature)}`, at: now };
  return cachedToken.value;
}

export const resetTokenCache = () => {
  cachedToken = { value: null, at: 0 };
};

/**
 * Šalje jednu obavijest na jedan uređaj.
 * @returns {Promise<{ok: boolean, status: number, reason?: string}>}
 */
export function sendToDevice(deviceToken, notification) {
  return new Promise((resolve) => {
    const client = http2.connect(HOST());
    const body = JSON.stringify(notification);

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken()}`,
      'apns-topic': config.apns.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });

    let status = 0;
    let data = '';
    req.on('response', (headers) => {
      status = Number(headers[':status']);
    });
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      client.close();
      let reason;
      try {
        reason = data ? JSON.parse(data).reason : undefined;
      } catch {
        reason = data || undefined;
      }
      resolve({ ok: status === 200, status, reason });
    });
    req.on('error', (e) => {
      client.close();
      resolve({ ok: false, status: 0, reason: e.message });
    });
    req.end(body);
  });
}

/** Gradi APNs poruku iz naslova, teksta i podataka za otvaranje zaslona. */
export function buildNotification({ naslov, tekst, badge, podaci = {} }) {
  return {
    aps: {
      alert: { title: naslov, body: tekst },
      sound: 'default',
      ...(badge != null ? { badge } : {}),
    },
    ...podaci,
  };
}

/**
 * Šalje svim uređajima korisnika; uređaje koje Apple odbije kao nepostojeće briše.
 */
export async function sendToUser(store, email, notification) {
  if (!config.apns.enabled) return { sent: 0, skipped: 'apns_nije_podesen' };
  const devices = store.devicesFor(email);
  let sent = 0;

  for (const device of devices) {
    const res = await sendToDevice(device, notification);
    if (res.ok) {
      sent++;
      continue;
    }
    // 410 Gone ili BadDeviceToken znači da aplikacija više nije na tom uređaju
    if (res.status === 410 || res.reason === 'BadDeviceToken' || res.reason === 'Unregistered') {
      store.removeDevice(device);
    } else {
      console.error(`APNs ${res.status} ${res.reason || ''} za uređaj ${device.slice(0, 8)}…`);
    }
  }
  return { sent, total: devices.length };
}
