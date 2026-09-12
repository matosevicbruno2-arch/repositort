import assert from 'node:assert/strict';
import test from 'node:test';
import { colLetter, hrAmount, hrDate, nextId, prepareJobRow, validateJob } from '../src/lib/newjob.js';

const grid = () => [
  ['Radovi'],
  ['ID', 'Klijent', 'Projekt / posao', 'Opis / sljedeći korak', 'Status rada', 'Prioritet', 'Rok', 'Vrijednost posla (€)', 'Datum unosa'],
  ['1', 'Hotel Mar', 'Videonadzor', 'Naručiti', 'U tijeku', 'Visoko', '', '2.400,00', '1.8.2026.'],
  ['7', 'Pekara Split', 'Mreža', 'Gotovo', 'Završeno - fakturirano', 'Nisko', '', '800,00', '2.8.2026.'],
  [],
  ['Solo računi'],
  ['Broj računa', 'Klijent', 'Iznos (€)', 'Status praćenja'],
  ['24-1-1', 'Hotel Mar', '1.000,00', 'Za naplatiti'],
];

test('slovo stupca iz indeksa', () => {
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(8), 'I');
  assert.equal(colLetter(25), 'Z');
  assert.equal(colLetter(26), 'AA');
});

test('novi ID je najveći postojeći + 1', () => {
  assert.equal(nextId([['1'], ['7'], ['3']], 0), '8');
  assert.equal(nextId([], 0), '1');
});

test('provjera odbija posao bez klijenta i projekta', () => {
  const r = validateJob({ opis: 'nešto' });
  assert.equal(r.ok, false);
  assert.equal(r.greske.length, 2);
});

test('provjera odbija nepoznat prioritet i status', () => {
  assert.equal(validateJob({ klijent: 'A', projekt: 'B', prioritet: 'Srednje' }).ok, false);
  assert.equal(validateJob({ klijent: 'A', projekt: 'B', status: 'Nepoznato' }).ok, false);
});

test('provjera prima ispravan posao i postavlja zadane vrijednosti', () => {
  const r = validateJob({ klijent: 'Hotel Mar', projekt: 'Kamere' });
  assert.equal(r.ok, true);
  assert.equal(r.posao.status, 'Za napraviti');
  assert.equal(r.posao.prioritet, 'Normalno');
});

test('rok se prima kao GGGG-MM-DD i pretvara u lokalni datum', () => {
  const r = validateJob({ klijent: 'A', projekt: 'B', rok: '2026-09-20' });
  assert.equal(r.ok, true);
  assert.equal(hrDate(r.posao.rok), '20.9.2026.');
  assert.equal(validateJob({ klijent: 'A', projekt: 'B', rok: '20.9.2026' }).ok, false);
});

test('vrijednost se prima kao broj i kao hrvatski zapis', () => {
  assert.equal(validateJob({ klijent: 'A', projekt: 'B', vrijednost: 1500 }).posao.vrijednost, 1500);
  assert.equal(validateJob({ klijent: 'A', projekt: 'B', vrijednost: '1.500,50' }).posao.vrijednost, 1500.5);
  assert.equal(validateJob({ klijent: 'A', projekt: 'B', vrijednost: 'pet eura' }).ok, false);
});

test('iznos se zapisuje u hrvatskom formatu', () => {
  assert.equal(hrAmount(1500), '1.500,00');
  assert.equal(hrAmount(2400.5), '2.400,50');
});

test('novi redak se slaže po stupcima tablice Radovi', () => {
  const { posao } = validateJob({
    klijent: 'Kamp Stobreč',
    projekt: 'Rampa',
    opis: 'Montaža u srijedu',
    prioritet: 'Hitno',
    rok: '2026-09-20',
    vrijednost: 1500,
  });
  const plan = prepareJobRow([grid()], posao, new Date(2026, 8, 12));

  assert.equal(plan.id, '8');
  assert.deepEqual(plan.values, [
    '8', 'Kamp Stobreč', 'Rampa', 'Montaža u srijedu', 'Za napraviti', 'Hitno', '20.9.2026.', '1.500,00', '12.9.2026.',
  ]);
});

test('redak ide iza zadnjeg retka Radova, ne na kraj lista', () => {
  const { posao } = validateJob({ klijent: 'A', projekt: 'B' });
  const plan = prepareJobRow([grid()], posao);
  // Radovi zauzimaju retke 2-4 (1-indeksirano), pa novi redak ide na 5.
  assert.equal(plan.insertAtRow, 4);
  assert.equal(plan.a1, 'A5:I5');
});

test('tablica bez stupaca Radova daje jasnu grešku', () => {
  const { posao } = validateJob({ klijent: 'A', projekt: 'B' });
  assert.throws(() => prepareJobRow([[['ništa']]], posao), (e) => e.code === 'sheet_structure');
});
