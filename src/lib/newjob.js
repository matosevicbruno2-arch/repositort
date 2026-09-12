import { col, findTable } from './tables.js';
import { parseAmount } from './parse.js';

const JOB_HEADERS = ['ID', 'Klijent', 'Status rada'];
const PRIORITETI = ['Hitno', 'Visoko', 'Normalno', 'Nisko'];
const STATUSI = ['Za napraviti', 'U tijeku', 'Čeka materijal/klijenta'];

/** Datum u obliku kakav tablica koristi: 5.9.2026. */
export const hrDate = (d) => `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}.`;

/** Iznos u hrvatskom formatu, bez oznake valute: 1.234,56 */
export const hrAmount = (n) =>
  new Intl.NumberFormat('hr-HR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** Slovo stupca iz indeksa: 0 → A, 26 → AA */
export function colLetter(index) {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Sljedeći slobodni ID: najveći postojeći broj + 1. */
export function nextId(rows, idx) {
  let max = 0;
  for (const r of rows) {
    const n = parseInt(String(r[idx] ?? '').trim(), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1);
}

export function validateJob(input) {
  const greske = [];
  const klijent = String(input?.klijent ?? '').trim();
  const projekt = String(input?.projekt ?? '').trim();
  if (!klijent) greske.push('Klijent je obavezan.');
  if (!projekt) greske.push('Projekt / posao je obavezan.');

  const prioritet = String(input?.prioritet ?? 'Normalno').trim();
  if (!PRIORITETI.includes(prioritet)) greske.push(`Prioritet mora biti jedan od: ${PRIORITETI.join(', ')}.`);

  const status = String(input?.status ?? 'Za napraviti').trim();
  if (!STATUSI.includes(status)) greske.push(`Status mora biti jedan od: ${STATUSI.join(', ')}.`);

  let vrijednost = null;
  if (input?.vrijednost !== undefined && input?.vrijednost !== null && String(input.vrijednost).trim() !== '') {
    vrijednost = typeof input.vrijednost === 'number' ? input.vrijednost : parseAmount(input.vrijednost);
    if (vrijednost == null) greske.push('Vrijednost mora biti broj.');
  }

  let rok = null;
  if (input?.rok) {
    // iz aplikacije stiže YYYY-MM-DD
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(input.rok).trim());
    if (!m) greske.push('Rok mora biti u obliku GGGG-MM-DD.');
    else rok = new Date(+m[1], +m[2] - 1, +m[3]);
  }

  return {
    ok: greske.length === 0,
    greske,
    posao: {
      klijent,
      projekt,
      opis: String(input?.opis ?? '').trim(),
      status,
      prioritet,
      rok,
      vrijednost,
      napomena: String(input?.napomena ?? '').trim(),
    },
  };
}

/**
 * Priprema upis novog posla: pronalazi tablicu "Radovi", slaže redak po njezinim
 * stupcima i javlja na koje mjesto u listu ide.
 *
 * @returns {{gridIndex, insertAtRow, range, values, id}}
 */
export function prepareJobRow(grids, posao, danas = new Date()) {
  const jobs = findTable(grids, JOB_HEADERS);
  if (!jobs) {
    const err = new Error('Nisam pronašao tablicu "Radovi" u listu — je li struktura tablice promijenjena?');
    err.code = 'sheet_structure';
    throw err;
  }

  const id = nextId(jobs.rows, jobs.idx.ID);
  const width = Math.max(jobs.width, ...jobs.rows.map((r) => r.length), 1);
  const values = new Array(width).fill('');
  const set = (header, value) => {
    const i = jobs.idx[header];
    if (i != null && value != null && value !== '') values[i] = String(value);
  };

  set('ID', id);
  set('Klijent', posao.klijent);
  set('Projekt / posao', posao.projekt);
  set('Opis / sljedeći korak', posao.opis);
  set('Status rada', posao.status);
  set('Prioritet', posao.prioritet);
  set('Rok', posao.rok ? hrDate(posao.rok) : '');
  set('Vrijednost posla (€)', posao.vrijednost != null ? hrAmount(posao.vrijednost) : '');
  set('Datum unosa', hrDate(danas));
  set('Napomena', posao.napomena);

  // Redak ide odmah iza zadnjeg retka tablice Radovi, a ne na kraj lista —
  // ispod mogu biti druge tablice.
  const insertAtRow = jobs.lastRow + 1;
  return {
    gridIndex: jobs.gridIndex,
    insertAtRow,
    a1: `A${insertAtRow + 1}:${colLetter(width - 1)}${insertAtRow + 1}`,
    values,
    id,
  };
}
