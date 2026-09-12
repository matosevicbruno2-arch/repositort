/**
 * Provjera ugovora između poslužitelja i iOS aplikacije.
 *
 * Swift dekodira JSON strogo: polje koje model očekuje, a odgovor ga nema,
 * ruši dekodiranje. Kako se aplikacija ne može prevesti u ovom okruženju, ovdje
 * se iz Models.swift čitaju očekivana polja i uspoređuju sa stvarnim odgovorom.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { computeDashboard } from '../src/lib/dashboard.js';
import { validateJob, prepareJobRow } from '../src/lib/newjob.js';

const swift = fs.readFileSync(new URL('../ios/ElinkPult/Models.swift', import.meta.url), 'utf8');

/** Čita nazive polja jedne strukture iz Models.swift. */
function poljaStrukture(ime) {
  const m = new RegExp(`struct ${ime}[^{]*\\{([\\s\\S]*?)\\n\\}`).exec(swift);
  assert.ok(m, `Struktura ${ime} nije pronađena u Models.swift`);
  const tijelo = m[1];

  // CodingKeys mijenjaju naziv polja u JSON-u (npr. sifra = "id")
  const preimenovanja = {};
  const ck = /enum CodingKeys[^{]*\{([\s\S]*?)\}/.exec(tijelo);
  if (ck) {
    for (const r of ck[1].matchAll(/case\s+(\w+)\s*=\s*"([^"]+)"/g)) preimenovanja[r[1]] = r[2];
  }

  const polja = [];
  for (const r of tijelo.matchAll(/^\s{4}let\s+(\w+)\s*:\s*([^\n=]+)$/gm)) {
    const naziv = r[1];
    const tip = r[2].trim();
    polja.push({ naziv: preimenovanjaili(preimenovanja, naziv), obavezno: !tip.endsWith('?') });
  }
  return polja;
}
const preimenovanjaili = (mapa, naziv) => mapa[naziv] ?? naziv;

/** Sva obavezna (neopcionalna) polja moraju postojati i ne smiju biti null. */
function provjeri(struktura, objekt, putanja = struktura) {
  for (const { naziv, obavezno } of poljaStrukture(struktura)) {
    assert.ok(naziv in objekt, `${putanja}: odgovor nema polje "${naziv}" koje aplikacija očekuje`);
    if (obavezno) {
      assert.notEqual(objekt[naziv], null, `${putanja}.${naziv} je null, a u Swiftu nije opcionalno`);
      assert.notEqual(objekt[naziv], undefined, `${putanja}.${naziv} nedostaje`);
    }
  }
}

const dan = (o) => {
  const d = new Date();
  d.setDate(d.getDate() + o);
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}.`;
};

const grid = [
  ['ID', 'Klijent', 'Projekt / posao', 'Opis / sljedeći korak', 'Status rada', 'Prioritet', 'Rok', 'Vrijednost posla (€)', 'Datum unosa', 'Datum završetka', 'Za fakturirati (€)', 'Broj računa', 'Napomena'],
  ['1', 'Hotel Mar', 'Kamere', 'Naručiti', 'U tijeku', 'Hitno', dan(3), '2.400,00', dan(-10), '', '', '', 'bilješka'],
  ['2', 'Pekara', 'Mreža', 'Fakturirati', 'Završeno - nije fakturirano', 'Normalno', '', '800,00', dan(-30), dan(-20), '800,00', '', ''],
  [],
  ['Broj računa', 'Klijent', 'Datum računa', 'Rok plaćanja', 'Iznos (€)', 'Status praćenja', 'Solo status', 'PDF'],
  ['68-1-1', 'Kamp', dan(-40), dan(-12), '3.000,00', 'Za naplatiti', 'Poslan', 'https://x/68.pdf'],
  ['24-1-1', 'Hotel Mar', dan(-60), dan(-30), '1.000,00', 'Za naplatiti', 'Poslan', ''],
  ['26-1-1', 'Hotel Mar', dan(-58), dan(-28), '-1.000,00', 'Za naplatiti', 'Storno', ''],
  [],
  ['Ime', 'Iznos', 'Datum uplate'],
  ['Hotel Mar', '1.200,00', '15.3.2026.'],
];

test('odgovor /api/pult ima sva polja koja Swift modeli traže', () => {
  const d = computeDashboard([grid]);
  provjeri('Pult', d);
  provjeri('Zbrojevi', d.totals, 'Pult.totals');
  provjeri('Primici', d.income, 'Pult.income');

  assert.ok(d.due.length, 'test treba barem jedan račun');
  for (const r of d.due) provjeri('Racun', r, 'Pult.due[]');
  for (const c of d.cancelled) provjeri('Storno', c, 'Pult.cancelled[]');
  for (const j of [...d.open, ...d.toInvoice]) provjeri('Posao', j, 'Pult.open[]');
  for (const m of d.income.byMonth) provjeri('Mjesec', m, 'Pult.income.byMonth[]');
});

test('polja koja Swift drži obaveznima nikad ne dolaze kao null', () => {
  // Posao bez ijednog neobaveznog podatka — najgori slučaj za dekodiranje.
  const rijedak = [
    ['ID', 'Klijent', 'Projekt / posao', 'Opis / sljedeći korak', 'Status rada', 'Prioritet'],
    ['', '', '', '', 'Za napraviti', ''],
    [],
    ['Broj računa', 'Klijent', 'Iznos (€)', 'Status praćenja'],
    ['9-1-1', '', '100,00', 'Za naplatiti'],
  ];
  const d = computeDashboard([rijedak]);
  for (const j of d.open) provjeri('Posao', j, 'Posao bez podataka');
  for (const r of d.due) provjeri('Racun', r, 'Racun bez roka');
  assert.equal(d.due[0].rok, null); // opcionalno u Swiftu, pa null je u redu
  assert.equal(d.due[0].client, '(bez klijenta)'); // obavezno, pa mora imati vrijednost
});

test('odgovor na upis posla ima polja koja aplikacija čita', () => {
  const { posao } = validateJob({ klijent: 'A', projekt: 'B' });
  const plan = prepareJobRow([grid], posao);
  const odgovor = { id: plan.id, redak: plan.insertAtRow + 1, list: 'Radovi' };
  provjeri('UnosOdgovor', odgovor);
});

test('polja koja aplikacija šalje pri unosu posla poslužitelj prihvaća', () => {
  // NoviPosao u Swiftu šalje ova polja; provjera da ih validateJob sva razumije.
  const izAplikacije = {
    klijent: 'Kamp Stobreč',
    projekt: 'Rampa',
    opis: 'Montaža',
    status: 'U tijeku',
    prioritet: 'Hitno',
    rok: '2026-09-20',
    vrijednost: 1500,
    napomena: 'terenski unos',
  };
  const r = validateJob(izAplikacije);
  assert.equal(r.ok, true, r.greske.join(' '));
  assert.equal(r.posao.napomena, 'terenski unos');
  assert.equal(r.posao.prioritet, 'Hitno');
});

test('Swift šalje samo vrijednosti koje poslužitelj dopušta', () => {
  const popis = (ime) => {
    const m = new RegExp(`${ime} = \\[([^\\]]+)\\]`).exec(swift);
    assert.ok(m, `Popis ${ime} nije pronađen u Models.swift`);
    return m[1].match(/"([^"]+)"/g).map((v) => v.slice(1, -1));
  };
  const statusi = popis('statusi');
  const prioriteti = popis('prioriteti');
  assert.ok(statusi.length && prioriteti.length);

  for (const status of statusi) {
    assert.equal(validateJob({ klijent: 'A', projekt: 'B', status }).ok, true, `status "${status}" odbijen`);
  }
  for (const prioritet of prioriteti) {
    assert.equal(validateJob({ klijent: 'A', projekt: 'B', prioritet }).ok, true, `prioritet "${prioritet}" odbijen`);
  }
});
