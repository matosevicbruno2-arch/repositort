import assert from 'node:assert/strict';
import test from 'node:test';
import { openStore } from '../src/lib/store.js';
import { createSessionStore } from '../src/lib/session-store.js';

/** express-session radi s povratnim pozivima, pa ih ovdje pretvaramo u obećanja. */
const promisify = (store) => ({
  get: (sid) => new Promise((res, rej) => store.get(sid, (e, v) => (e ? rej(e) : res(v)))),
  set: (sid, sess) => new Promise((res, rej) => store.set(sid, sess, (e) => (e ? rej(e) : res()))),
  destroy: (sid) => new Promise((res, rej) => store.destroy(sid, (e) => (e ? rej(e) : res()))),
  touch: (sid, sess) => new Promise((res, rej) => store.touch(sid, sess, (e) => (e ? rej(e) : res()))),
  length: () => new Promise((res, rej) => store.length((e, v) => (e ? rej(e) : res(v)))),
  raw: store,
});

const noviStore = () => {
  const baza = openStore(':memory:', 'tajna');
  return { baza, s: promisify(createSessionStore(baza.db)) };
};

const sesija = (maxAge = 3600_000) => ({
  cookie: { originalMaxAge: maxAge },
  tokens: { access_token: 'abc' },
  user: { email: 'bruno@elink.hr' },
});

test('sesija se spremi i pročita s cijelim sadržajem', async () => {
  const { s, baza } = noviStore();
  await s.set('sid1', sesija());
  const vracena = await s.get('sid1');
  assert.equal(vracena.user.email, 'bruno@elink.hr');
  assert.equal(vracena.tokens.access_token, 'abc');
  baza.close();
});

test('nepoznata sesija vraća null, ne grešku', async () => {
  const { s, baza } = noviStore();
  assert.equal(await s.get('nepostojeca'), null);
  baza.close();
});

test('ponovni upis iste sesije je izmjena, ne duplikat', async () => {
  const { s, baza } = noviStore();
  await s.set('sid1', sesija());
  await s.set('sid1', { ...sesija(), user: { email: 'drugi@elink.hr' } });
  assert.equal(await s.length(), 1);
  assert.equal((await s.get('sid1')).user.email, 'drugi@elink.hr');
  baza.close();
});

test('istekla sesija se ne vraća i briše se pri čitanju', async () => {
  const { s, baza } = noviStore();
  await s.set('sid1', sesija(-1000)); // već istekla
  assert.equal(await s.get('sid1'), null);
  assert.equal(await s.length(), 0);
  baza.close();
});

test('odjava briše sesiju', async () => {
  const { s, baza } = noviStore();
  await s.set('sid1', sesija());
  await s.destroy('sid1');
  assert.equal(await s.get('sid1'), null);
  baza.close();
});

test('touch produžuje sesiju bez diranja sadržaja', async () => {
  const { s, baza } = noviStore();
  await s.set('sid1', sesija(1000));
  await s.touch('sid1', sesija(3600_000));
  const vracena = await s.get('sid1');
  assert.equal(vracena.user.email, 'bruno@elink.hr'); // sadržaj netaknut
  baza.close();
});

test('čišćenje uklanja samo istekle sesije', async () => {
  const { s, baza } = noviStore();
  await s.set('stara', sesija(-1000));
  await s.set('nova', sesija(3600_000));
  s.raw.ocistiIstekle();
  assert.equal(await s.length(), 1);
  assert.ok(await s.get('nova'));
  baza.close();
});

test('sesija bez maxAge dobiva razuman rok umjesto da odmah istekne', async () => {
  const { s, baza } = noviStore();
  await s.set('sid1', { cookie: {}, user: { email: 'x@y.hr' } });
  assert.ok(await s.get('sid1'));
  baza.close();
});
