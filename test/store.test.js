import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore } from '../src/lib/store.js';
import { decrypt, encrypt, hashToken, newToken } from '../src/lib/crypto.js';

const fresh = () => openStore(':memory:', 'tajna-za-test');

test('šifriranje vraća original, a zapis ne sadrži čisti tekst', () => {
  const enc = encrypt('1//refresh-token-abc', 'kljuc');
  assert.notEqual(enc, '1//refresh-token-abc');
  assert.equal(enc.includes('refresh-token'), false);
  assert.equal(decrypt(enc, 'kljuc'), '1//refresh-token-abc');
});

test('krivi ključ ne otkriva sadržaj nego vraća null', () => {
  assert.equal(decrypt(encrypt('tajna', 'kljuc-a'), 'kljuc-b'), null);
  assert.equal(decrypt('smeće', 'kljuc'), null);
});

test('refresh token se pohrani i pročita', () => {
  const s = fresh();
  s.saveUser('bruno@elink.hr', '1//token');
  assert.equal(s.getRefreshToken('bruno@elink.hr'), '1//token');
  assert.deepEqual(s.listUsersWithToken(), ['bruno@elink.hr']);
  s.close();
});

test('ponovna prijava bez refresh tokena ne briše postojeći', () => {
  const s = fresh();
  s.saveUser('bruno@elink.hr', '1//token');
  s.saveUser('bruno@elink.hr', undefined); // Google ga šalje samo prvi put
  assert.equal(s.getRefreshToken('bruno@elink.hr'), '1//token');
  s.close();
});

test('token aplikacije se pamti samo kao otisak', () => {
  const s = fresh();
  const token = newToken();
  s.issueAppToken('bruno@elink.hr', token);

  assert.equal(s.emailForAppToken(token), 'bruno@elink.hr');
  assert.equal(s.emailForAppToken('krivi-token'), null);

  const row = s.db.prepare('SELECT token_hash FROM app_tokens').get();
  assert.equal(row.token_hash, hashToken(token));
  assert.equal(row.token_hash.includes(token), false);
  s.close();
});

test('odjava aplikacije poništava token', () => {
  const s = fresh();
  const token = newToken();
  s.issueAppToken('bruno@elink.hr', token);
  s.revokeAppToken(token);
  assert.equal(s.emailForAppToken(token), null);
  s.close();
});

test('uređaji se registriraju po korisniku i mogu se ukloniti', () => {
  const s = fresh();
  s.registerDevice('bruno@elink.hr', 'aa11');
  s.registerDevice('bruno@elink.hr', 'bb22');
  s.registerDevice('bruno@elink.hr', 'aa11'); // isti uređaj dvaput
  assert.deepEqual(s.devicesFor('bruno@elink.hr').sort(), ['aa11', 'bb22']);

  s.removeDevice('aa11');
  assert.deepEqual(s.devicesFor('bruno@elink.hr'), ['bb22']);
  s.close();
});

test('ista obavijest se ne šalje dvaput', () => {
  const s = fresh();
  assert.equal(s.markNotified('racun:68-1-1:kasni:7'), true);
  assert.equal(s.markNotified('racun:68-1-1:kasni:7'), false);
  assert.equal(s.markNotified('racun:68-1-1:kasni:14'), true);
  s.close();
});

test('stari zapisi obavijesti se čiste', () => {
  const s = fresh();
  s.markNotified('staro');
  s.db.prepare('UPDATE sent_notifications SET sent_at = ?').run(Date.now() - 120 * 86400000);
  s.pruneNotifications(90);
  assert.equal(s.markNotified('staro'), true); // više nije zapamćeno
  s.close();
});
