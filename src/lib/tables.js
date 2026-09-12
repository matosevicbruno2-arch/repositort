/**
 * Pronalaženje tablica unutar listova Google tablice.
 *
 * Jedan list može sadržavati više odvojenih tablica (npr. "Radovi", "Solo računi",
 * "Primici"), zato se traži redak zaglavlja koji sadrži sve tražene stupce, a
 * podaci se čitaju do prvog potpuno praznog retka.
 */

const clean = (v) => String(v ?? '').trim();

/**
 * @param {string[][][]} grids  vrijednosti po listu
 * @param {string[]} headerCells  stupci koji moraju postojati u zaglavlju
 * @returns {{idx: Record<string, number>, rows: string[][]} | null}
 */
export function findTable(grids, headerCells) {
  for (const grid of grids) {
    if (!grid) continue;
    for (let r = 0; r < grid.length; r++) {
      const row = (grid[r] || []).map(clean);
      if (!headerCells.every((h) => row.includes(h))) continue;

      const idx = {};
      row.forEach((c, i) => {
        if (c && !(c in idx)) idx[c] = i;
      });

      const rows = [];
      for (let i = r + 1; i < grid.length; i++) {
        const cells = (grid[i] || []).map(clean);
        if (!cells.some((c) => c)) break; // prazan redak = kraj tablice
        rows.push(cells);
      }
      return { idx, rows };
    }
  }
  return null;
}

/** Vrijednost stupca po nazivu zaglavlja. */
export const col = (tbl, row, name) => (tbl.idx[name] != null ? row[tbl.idx[name]] || '' : '');
