import assert from 'node:assert/strict';
import test from 'node:test';
import { computeDashboard } from '../src/lib/dashboard.js';
import { parseAmount, parseDate, isoDay } from '../src/lib/parse.js';
import { findTable, col } from '../src/lib/tables.js';

const dan = (offset) => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}.`;
};

/** List s tri tablice, kao u stvarnoj radnoj knjizi. */
function grid() {
  return [
    ['Radovi'],
    ['ID', 'Klijent', 'Projekt / posao', 'Opis / sljedeći korak', 'Status rada', 'Prioritet', 'Rok', 'Vrijednost posla (€)', 'Datum unosa', 'Datum završetka', 'Za fakturirati (€)', 'Broj računa', 'Napomena'],
    ['1', 'Hotel Mar', 'Videonadzor', 'Naručiti kamere', 'U tijeku', 'Visoko', dan(3), '2.400,00', dan(-10), '', '', '', ''],
    ['2', 'Kamp Stobreč', 'Parking LPR', 'Čeka rampu', 'Čeka materijal/klijenta', 'Normalno', dan(12), '5.000,00', dan(-20), '', '', '', ''],
    ['3', 'Pekara Split', 'Mreža', 'Ispostaviti račun', 'Završeno - nije fakturirano', 'Normalno', '', '800,00', dan(-30), dan(-20), '800,00', '', 'čeka odobrenje'],
    ['4', 'Vila Trogir', 'Vatrodojava', 'Gotovo', 'Završeno - fakturirano', 'Nisko', '', '1.200,00', dan(-60), dan(-40), '', '70-1-1', ''],
    [],
    ['Solo računi'],
    ['Broj računa', 'Klijent', 'Datum računa', 'Rok plaćanja', 'Iznos (€)', 'Status praćenja', 'Solo status', 'PDF'],
    ['24-1-1', 'Hotel Mar', dan(-60), dan(-30), '1.000,00', 'Za naplatiti', 'Poslan', 'https://primjer/24.pdf'],
    ['26-1-1', 'Hotel Mar', dan(-58), dan(-28), '-1.000,00', 'Za naplatiti', 'Storno', ''],
    ['68-1-1', 'Kamp Stobreč', dan(-20), dan(-5), '3.000,00', 'Za naplatiti', 'Poslan', 'https://primjer/68.pdf'],
    ['71-1-1', 'Pekara Split', dan(-4), dan(10), '500,00', 'Za naplatiti', 'Poslan', ''],
    ['72-1-1', 'Vila Trogir', dan(-90), dan(-60), '1.200,00', 'Naplaćeno', 'Plaćen', ''],
    [],
    ['Primici'],
    ['Ime', 'Iznos', 'Datum uplate'],
    ['Vila Trogir', '1.200,00', '15.3.2026.'],
    ['Hotel Mar', '800,00', '20.3.2026.'],
    ['Kamp Stobreč', '2.000,00', '10.5.2026.'],
    ['Ukupno', '4.000,00', ''],
  ];
}

test('parseAmount čita hrvatski format, uključujući negativne i unicode minus', () => {
  assert.equal(parseAmount('1.234,56 €'), 1234.56);
  assert.equal(parseAmount('−1.000,00'), -1000);
  assert.equal(parseAmount('800,00'), 800);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('nije broj'), null);
});

test('parseDate čita d.m.gggg. i vraća lokalnu ponoć', () => {
  const d = parseDate('5.9.2026.');
  assert.equal(isoDay(d), '2026-09-05');
  assert.equal(d.getHours(), 0);
  assert.equal(parseDate('bez datuma'), null);
});

test('findTable pronalazi tablicu koja ne počinje u prvom retku', () => {
  const t = findTable([grid()], ['Ime', 'Iznos', 'Datum uplate']);
  assert.ok(t);
  assert.equal(t.rows.length, 4);
  assert.equal(col(t, t.rows[0], 'Ime'), 'Vila Trogir');
});

test('storno par ispada s popisa za naplatu i prijavljuje se zasebno', () => {
  const d = computeDashboard([grid()]);
  const brojevi = d.due.map((x) => x.no);
  assert.deepEqual(brojevi.includes('24-1-1'), false);
  assert.deepEqual(brojevi.includes('26-1-1'), false);
  assert.equal(d.cancelled.length, 1);
  assert.deepEqual(
    { racun: d.cancelled[0].racun, storno: d.cancelled[0].storno },
    { racun: '24-1-1', storno: '26-1-1' },
  );
});

test('za naplatu ostaju samo otvoreni računi, sortirani po kašnjenju', () => {
  const d = computeDashboard([grid()]);
  assert.deepEqual(d.due.map((x) => x.no), ['68-1-1', '71-1-1']);
  assert.equal(d.due[0].late, 5); // rok prije 5 dana
  assert.equal(d.due[1].late, -10); // rok za 10 dana
  assert.equal(d.totals.overdueCount, 1);
  assert.equal(d.totals.dueOverdue, 3000);
  // dueSum obuhvaća i storno par: 1000 - 1000 + 3000 + 500
  assert.equal(d.totals.dueSum, 3500);
});

test('naplaćeni račun nije na popisu za naplatu', () => {
  const d = computeDashboard([grid()]);
  assert.equal(d.due.some((x) => x.no === '72-1-1'), false);
});

test('otvoreni poslovi isključuju završene i zbrajaju vrijednost', () => {
  const d = computeDashboard([grid()]);
  assert.deepEqual(d.open.map((j) => j.id), ['1', '2']);
  assert.equal(d.totals.openValue, 7400);
});

test('za fakturirati obuhvaća samo završeno-nefakturirano', () => {
  const d = computeDashboard([grid()]);
  assert.deepEqual(d.toInvoice.map((j) => j.id), ['3']);
  assert.equal(d.totals.invoiceSum, 800);
});

test('primici se grupiraju po mjesecu, a Ukupno se ne broji kao uplata', () => {
  const d = computeDashboard([grid()]);
  assert.deepEqual(d.income.byMonth, [{ mjesec: '2026-03', iznos: 2000 }, { mjesec: '2026-05', iznos: 2000 }]);
  assert.equal(d.income.paidTotal, 4000); // iz retka "Ukupno"
});

test('tablica bez očekivanih stupaca daje jasnu grešku', () => {
  assert.throws(() => computeDashboard([[['nešto', 'drugo']]]), (e) => e.code === 'sheet_structure');
});

test('primici se zbrajaju i kad nema retka Ukupno', () => {
  const g = grid().filter((r) => r[0] !== 'Ukupno');
  assert.equal(computeDashboard([g]).income.paidTotal, 4000);
});

test('tablice se pronalaze i kad su razdvojene po listovima', () => {
  const g = grid();
  const radovi = g.slice(0, 6);
  const ostalo = g.slice(7);
  const d = computeDashboard([radovi, ostalo]);
  assert.equal(d.open.length, 2);
  assert.equal(d.due.length, 2);
});
