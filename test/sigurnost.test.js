/** Provjere popravaka iz sigurnosnog pregleda. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore } from '../src/lib/store.js';
import { newToken } from '../src/lib/crypto.js';

const fresh = () => openStore(':memory:', 'tajna');

test('token aplikacije prestaje vrijediti nakon isteka', () => {
  const s = fresh();
  const token = newToken();
  s.issueAppToken('bruno@elink.hr', token, -1000); // već istekao
  assert.equal(s.emailForAppToken(token), null);
  // istekli zapis se i briše, da se ne gomila
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM app_tokens').get().n, 0);
  s.close();
});

test('token unutar roka i dalje vrijedi', () => {
  const s = fresh();
  const token = newToken();
  s.issueAppToken('bruno@elink.hr', token, 3600_000);
  assert.equal(s.emailForAppToken(token), 'bruno@elink.hr');
  s.close();
});

test('novi token dobiva rok i kad se ne zada izričito', () => {
  const s = fresh();
  const token = newToken();
  s.issueAppToken('bruno@elink.hr', token);
  const row = s.db.prepare('SELECT expires_at FROM app_tokens').get();
  assert.ok(row.expires_at > Date.now(), 'token mora imati rok u budućnosti');
  assert.ok(row.expires_at < Date.now() + 400 * 24 * 3600 * 1000, 'rok ne smije biti praktički vječan');
  s.close();
});

test('gubitak pristupa poništava sve tokene korisnika odjednom', () => {
  const s = fresh();
  const a = newToken();
  const b = newToken();
  s.issueAppToken('bruno@elink.hr', a);
  s.issueAppToken('bruno@elink.hr', b);
  s.issueAppToken('druga@elink.hr', newToken());

  s.revokeAllAppTokens('bruno@elink.hr');
  assert.equal(s.emailForAppToken(a), null);
  assert.equal(s.emailForAppToken(b), null);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM app_tokens').get().n, 1); // tuđi ostaje
  s.close();
});

test('uređaj se iz zahtjeva može obrisati samo vlastiti', () => {
  const s = fresh();
  s.registerDevice('bruno@elink.hr', 'aa11');
  s.registerDevice('druga@elink.hr', 'bb22');

  assert.equal(s.removeDeviceForUser('bruno@elink.hr', 'bb22'), false, 'tuđi uređaj se ne smije obrisati');
  assert.deepEqual(s.devicesFor('druga@elink.hr'), ['bb22']);

  assert.equal(s.removeDeviceForUser('bruno@elink.hr', 'aa11'), true);
  assert.deepEqual(s.devicesFor('bruno@elink.hr'), []);
  s.close();
});

test('čišćenje nakon APNs odbijanja i dalje briše bez obzira na vlasnika', () => {
  const s = fresh();
  s.registerDevice('bruno@elink.hr', 'aa11');
  s.removeDevice('aa11'); // poziva ga poslužitelj kad Apple javi da uređaj ne postoji
  assert.deepEqual(s.devicesFor('bruno@elink.hr'), []);
  s.close();
});

test('baza bez stupca za istek se nadograđuje bez gubitka podataka', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  // stara shema, kakva je bila prije uvođenja isteka
  db.exec(`CREATE TABLE app_tokens (token_hash TEXT PRIMARY KEY, email TEXT NOT NULL,
           created_at INTEGER NOT NULL, last_used_at INTEGER)`);
  db.prepare('INSERT INTO app_tokens VALUES (?, ?, ?, NULL)').run('hash', 'stari@elink.hr', Date.now());

  const s = openStore(':memory:', 'tajna');
  const stupci = s.db.prepare('PRAGMA table_info(app_tokens)').all().map((r) => r.name);
  assert.ok(stupci.includes('expires_at'));
  s.close();
  db.close();
});
