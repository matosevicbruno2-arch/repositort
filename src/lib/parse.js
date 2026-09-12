/** Pomoćne funkcije za čitanje hrvatski formatiranih vrijednosti iz Google tablice. */

/** "1.234,56 €" → 1234.56; "-1.234,56" i "−1.234,56" → -1234.56 */
export function parseAmount(s) {
  if (s == null || s === '') return null;
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  const t = String(s)
    .replace(/[€\s ]/g, '')
    .replace(/[−–]/g, '-')
    .replace(/\./g, '')
    .replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

/** "1.9.2026." → Date (lokalna ponoć). Vraća null ako nema datuma. */
export function parseDate(s) {
  const m = /(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/.exec(String(s ?? ''));
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Datum → "YYYY-MM-DD" (bez vremenske zone, da se ne pomakne dan). */
export function isoDay(d) {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysBetween(a, b) {
  return Math.round((a - b) / 86_400_000);
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
