import assert from 'node:assert/strict';
import test from 'node:test';
import { planNotifications } from '../src/lib/notifications.js';
import { isoDay } from '../src/lib/parse.js';

const danas = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const pomak = (dana) => { const d = danas(); d.setDate(d.getDate() + dana); return isoDay(d); };

const pult = ({ due = [], open = [] } = {}) => ({
  due, open, cancelled: [], toInvoice: [],
  income: { byMonth: [], paidTotal: 0 },
  totals: { dueSum: 0, dueOverdue: 0, overdueCount: due.filter((d) => d.late > 0).length, openValue: 0, invoiceSum: 0 },
});

const racun = (o) => ({ no: '68-1-1', client: 'Kamp Stobreč', amount: 3000, rok: pomak(-8), late: 8, ...o });

test('račun koji kasni javlja se na najvišem dosegnutom pragu', () => {
  const p = planNotifications(pult({ due: [racun({ late: 8 })] }));
  assert.equal(p.length, 1);
  assert.equal(p[0].key, 'racun:68-1-1:kasni:7');
  assert.match(p[0].naslov, /kasni 8 dana/);
  assert.match(p[0].tekst, /Kamp Stobreč/);
});

test('niži pragovi se označe kao odrađeni, da ne stigne rafal obavijesti', () => {
  const p = planNotifications(pult({ due: [racun({ late: 40 })] }));
  assert.equal(p.length, 1);
  assert.equal(p[0].key, 'racun:68-1-1:kasni:30');
  assert.deepEqual(p[0].alsoMark, ['racun:68-1-1:kasni:1', 'racun:68-1-1:kasni:7', 'racun:68-1-1:kasni:14']);
});

test('račun koji još nije dospio ne javlja ništa', () => {
  assert.equal(planNotifications(pult({ due: [racun({ late: -5 })] })).length, 0);
});

test('račun kojem rok ističe danas javlja se zasebno', () => {
  const p = planNotifications(pult({ due: [racun({ late: 0, rok: pomak(0) })] }));
  assert.equal(p[0].key, 'racun:68-1-1:rok-danas');
  assert.match(p[0].naslov, /Danas ističe rok/);
});

test('storno i negativni iznosi se preskaču', () => {
  assert.equal(planNotifications(pult({ due: [racun({ amount: -3000, late: 40 })] })).length, 0);
});

test('račun bez roka ne javlja ništa', () => {
  assert.equal(planNotifications(pult({ due: [racun({ late: null, rok: null })] })).length, 0);
});

test('posao javlja rok danas i sutra, ali ne dalje', () => {
  const posao = (id, rok) => ({ id, client: 'Hotel Mar', proj: 'Kamere', projekt: 'Kamere', desc: 'Montaža', rok });
  const p = planNotifications(pult({ open: [posao('1', pomak(0)), posao('2', pomak(1)), posao('3', pomak(3))] }));
  assert.deepEqual(p.map((x) => x.podaci.id), ['1', '2']);
  assert.match(p[0].naslov, /^Danas je rok/);
  assert.match(p[1].naslov, /^Sutra je rok/);
});

test('posao bez roka se preskače', () => {
  assert.equal(planNotifications(pult({ open: [{ id: '9', client: 'A', proj: 'B', rok: null }] })).length, 0);
});

test('ključevi su jedinstveni po računu i pragu', () => {
  const p = planNotifications(pult({
    due: [racun({ no: '68-1-1', late: 8 }), racun({ no: '71-1-1', late: 8 })],
  }));
  assert.equal(new Set(p.map((x) => x.key)).size, 2);
});
