/**
 * Pravila za push obavijesti.
 *
 * Čista funkcija nad stanjem pulta: odlučuje što bi trebalo javiti, ali ne šalje
 * ništa i ne zna za bazu — zato se provjerava testovima.
 */
import { daysBetween, startOfToday } from './parse.js';

/** Pragovi kašnjenja o kojima se javlja (u danima). */
const PRAGOVI = [1, 7, 14, 30, 60];

const fmtEUR = (n) =>
  new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);

const dayOf = (iso) => (iso ? new Date(`${iso}T00:00:00`) : null);

/**
 * @param {object} dashboard  rezultat computeDashboard
 * @returns {Array<{key: string, alsoMark: string[], naslov: string, tekst: string, podaci: object}>}
 */
export function planNotifications(dashboard, { today = startOfToday() } = {}) {
  const out = [];

  for (const d of dashboard.due) {
    if (d.amount <= 0) continue;

    if (d.late != null && d.late > 0) {
      // Javi samo najviši dosegnuti prag, a niže označi kao odrađene — inače bi
      // račun koji kasni 40 dana pri prvoj provjeri poslao četiri obavijesti.
      const dosegnuti = PRAGOVI.filter((p) => d.late >= p);
      if (!dosegnuti.length) continue;
      const prag = dosegnuti[dosegnuti.length - 1];
      out.push({
        key: `racun:${d.no}:kasni:${prag}`,
        alsoMark: dosegnuti.slice(0, -1).map((p) => `racun:${d.no}:kasni:${p}`),
        naslov: `Račun ${d.no} kasni ${d.late} ${d.late === 1 ? 'dan' : 'dana'}`,
        tekst: `${d.client} · ${fmtEUR(d.amount)}`,
        podaci: { vrsta: 'racun', broj: d.no },
      });
    } else if (d.late === 0) {
      out.push({
        key: `racun:${d.no}:rok-danas`,
        alsoMark: [],
        naslov: `Danas ističe rok za račun ${d.no}`,
        tekst: `${d.client} · ${fmtEUR(d.amount)}`,
        podaci: { vrsta: 'racun', broj: d.no },
      });
    }
  }

  for (const j of dashboard.open) {
    const rok = dayOf(j.rok);
    if (!rok) continue;
    const preostalo = -daysBetween(today, rok);
    if (preostalo !== 0 && preostalo !== 1) continue;
    out.push({
      key: `posao:${j.id}:rok:${j.rok}`,
      alsoMark: [],
      naslov: preostalo === 0 ? `Danas je rok: ${j.projekt || j.proj}` : `Sutra je rok: ${j.projekt || j.proj}`,
      tekst: `${j.client}${j.desc ? ` · ${j.desc}` : ''}`,
      podaci: { vrsta: 'posao', id: j.id },
    });
  }

  return out;
}
