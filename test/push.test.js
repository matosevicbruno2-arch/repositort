import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

// APNs postavke moraju postojati prije učitavanja modula koji ih čita.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.GOOGLE_CLIENT_ID ||= 'test';
process.env.GOOGLE_CLIENT_SECRET ||= 'test';
process.env.SHEET_ID ||= 'test';
process.env.SESSION_SECRET ||= 'test';
process.env.APNS_KEY_ID = 'ABC1234567';
process.env.APNS_TEAM_ID = 'TEAM123456';
process.env.APNS_BUNDLE_ID = 'hr.elink.pult';
process.env.APNS_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });

const { buildNotification, providerToken, resetTokenCache } = await import('../src/services/push.js');
const { config } = await import('../src/config.js');

test('APNs postavke se prepoznaju kao potpune', () => {
  assert.equal(config.apns.enabled, true);
});

test('token je ispravno potpisan ES256 JWT s Appleovim poljima', () => {
  resetTokenCache();
  const token = providerToken();
  const [h, p, s] = token.split('.');

  const header = JSON.parse(Buffer.from(h, 'base64url'));
  const payload = JSON.parse(Buffer.from(p, 'base64url'));
  assert.deepEqual(header, { alg: 'ES256', kid: 'ABC1234567' });
  assert.equal(payload.iss, 'TEAM123456');
  assert.ok(Math.abs(payload.iat - Math.floor(Date.now() / 1000)) < 5);

  // Apple traži sirovi r||s potpis (64 bajta), ne DER
  const signature = Buffer.from(s, 'base64url');
  assert.equal(signature.length, 64);
  assert.equal(
    crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, signature),
    true,
  );
});

test('token se ponovno koristi unutar sata, a ne izdaje se svaki put', () => {
  resetTokenCache();
  const prvi = providerToken(1_000_000);
  assert.equal(providerToken(1_000_000 + 10 * 60_000), prvi);
  assert.notEqual(providerToken(1_000_000 + 50 * 60_000), prvi);
});

test('obavijest ima oblik koji APNs očekuje', () => {
  const n = buildNotification({
    naslov: 'Račun 68-1-1 kasni 8 dana',
    tekst: 'Kamp Stobreč · 3.000 €',
    badge: 2,
    podaci: { vrsta: 'racun', broj: '68-1-1' },
  });
  assert.equal(n.aps.alert.title, 'Račun 68-1-1 kasni 8 dana');
  assert.equal(n.aps.alert.body, 'Kamp Stobreč · 3.000 €');
  assert.equal(n.aps.badge, 2);
  assert.equal(n.aps.sound, 'default');
  assert.equal(n.vrsta, 'racun'); // vlastiti podaci idu uz aps, ne unutra
});

test('badge se izostavlja kad nije zadan', () => {
  assert.equal('badge' in buildNotification({ naslov: 'a', tekst: 'b' }).aps, false);
});
