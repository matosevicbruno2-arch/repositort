/**
 * Izračun pulta iz vrijednosti listova Google tablice.
 *
 * Ovdje nema mreže ni postavki okruženja — ulaz su same vrijednosti ćelija,
 * pa se cijela poslovna logika provjerava testovima.
 */
import { col, findTable } from './tables.js';
import { daysBetween, isoDay, parseAmount, parseDate, startOfToday } from './parse.js';

const OPEN_STATUSES = ['Za napraviti', 'U tijeku', 'Čeka materijal/klijenta'];
const PRIO_RANK = { Hitno: 0, Visoko: 1, Normalno: 2, Nisko: 3 };

/**
 * Sparivanje storna: negativan račun poništava otvoreni pozitivan istog iznosa
 * (prednost ima isti klijent). Oba ispadaju s popisa za naplatu.
 */
function pairStorno(due) {
  const cancelled = [];
  for (const neg of due.filter((d) => d.amount < 0)) {
    if (neg.paired) continue;
    const cands = due.filter(
      (d) => !d.paired && d.amount > 0 && Math.abs(d.amount + neg.amount) < 0.005 && d !== neg,
    );
    const pos = cands.find((d) => d.client === neg.client) || cands[0];
    if (pos) {
      neg.paired = pos;
      pos.paired = neg;
      cancelled.push({ racun: pos.no, storno: neg.no, amount: pos.amount });
    }
  }
  return cancelled;
}

/** Čista logika pulta nad vrijednostima listova — bez mreže, pa je izravno provjerljiva. */
export function computeDashboard(grids, title = '') {
  const jobs = findTable(grids, ['ID', 'Klijent', 'Status rada']);
  const inv = findTable(grids, ['Broj računa', 'Status praćenja', 'Iznos (€)']);
  const income = findTable(grids, ['Ime', 'Iznos', 'Datum uplate']);

  if (!jobs || !inv) {
    const err = new Error(
      'Nisam pronašao tablice "Radovi" i "Solo računi" u listu — je li struktura tablice promijenjena?',
    );
    err.code = 'sheet_structure';
    throw err;
  }

  const today = startOfToday();

  // --- Računi za naplatiti ---
  const due = [];
  let dueSum = 0;
  for (const r of inv.rows) {
    if (col(inv, r, 'Status praćenja') !== 'Za naplatiti') continue;
    const amount = parseAmount(col(inv, r, 'Iznos (€)'));
    if (amount == null) continue;
    const rok = parseDate(col(inv, r, 'Rok plaćanja'));
    due.push({
      no: col(inv, r, 'Broj računa'),
      client: col(inv, r, 'Klijent') || '(bez klijenta)',
      amount,
      rok: isoDay(rok),
      late: rok ? daysBetween(today, rok) : null,
      solo: col(inv, r, 'Solo status'),
      pdf: col(inv, r, 'PDF'),
      date: isoDay(parseDate(col(inv, r, 'Datum računa'))),
    });
    dueSum += amount;
  }

  const cancelled = pairStorno(due);
  const openInvoices = due.filter((d) => !d.paired).map(({ paired, ...d }) => d);

  let dueOverdue = 0;
  let overdueCount = 0;
  for (const d of openInvoices) {
    if (d.late != null && d.late > 0 && d.amount > 0) {
      dueOverdue += d.amount;
      overdueCount++;
    }
  }
  openInvoices.sort((a, b) => (b.late ?? -9999) - (a.late ?? -9999) || b.amount - a.amount);

  // --- Poslovi ---
  const open = [];
  const toInvoice = [];
  let openValue = 0;
  for (const r of jobs.rows) {
    const status = col(jobs, r, 'Status rada');
    const item = {
      id: col(jobs, r, 'ID'),
      client: col(jobs, r, 'Klijent'),
      proj: col(jobs, r, 'Projekt / posao'),
      desc: col(jobs, r, 'Opis / sljedeći korak'),
      status,
      prio: col(jobs, r, 'Prioritet'),
      rok: isoDay(parseDate(col(jobs, r, 'Rok'))),
      val: parseAmount(col(jobs, r, 'Vrijednost posla (€)')),
      entered: isoDay(parseDate(col(jobs, r, 'Datum unosa'))),
      done: isoDay(parseDate(col(jobs, r, 'Datum završetka'))),
      toInv: parseAmount(col(jobs, r, 'Za fakturirati (€)')),
      invNo: col(jobs, r, 'Broj računa'),
      note: col(jobs, r, 'Napomena'),
    };
    if (OPEN_STATUSES.includes(status)) {
      open.push(item);
      openValue += item.val || 0;
    } else if (status === 'Završeno - nije fakturirano') {
      toInvoice.push(item);
    }
  }

  const ms = (iso) => (iso ? new Date(`${iso}T00:00:00`).getTime() : null);
  open.sort(
    (a, b) =>
      (ms(a.rok) ?? 8.64e15) - (ms(b.rok) ?? 8.64e15) ||
      (PRIO_RANK[a.prio] ?? 2) - (PRIO_RANK[b.prio] ?? 2) ||
      (b.val || 0) - (a.val || 0),
  );
  toInvoice.sort((a, b) => (ms(a.done) ?? ms(a.entered) ?? 0) - (ms(b.done) ?? ms(b.entered) ?? 0));
  const invoiceSum = toInvoice.reduce((a, j) => a + (j.val || j.toInv || 0), 0);

  // --- Primici po mjesecu ---
  let paidTotal = 0;
  const byMonth = new Map();
  if (income) {
    for (const r of income.rows) {
      const name = col(income, r, 'Ime');
      const amt = parseAmount(col(income, r, 'Iznos'));
      if (name === 'Ukupno') {
        if (amt != null) paidTotal = amt;
        continue;
      }
      const d = parseDate(col(income, r, 'Datum uplate'));
      if (amt == null || !d) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(key, (byMonth.get(key) || 0) + amt);
    }
    if (!paidTotal) for (const v of byMonth.values()) paidTotal += v;
  }

  return {
    title,
    today: isoDay(today),
    due: openInvoices,
    cancelled,
    open,
    toInvoice,
    income: {
      // Imenovana polja umjesto parova — jednostavnije za dekodiranje u aplikaciji.
      byMonth: [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([mjesec, iznos]) => ({ mjesec, iznos })),
      paidTotal,
    },
    totals: { dueSum, dueOverdue, overdueCount, openValue, invoiceSum },
  };
}
