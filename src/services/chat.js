import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { config } from '../config.js';
import { createEvent } from './calendar.js';

const fmtEUR = (n) =>
  new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n || 0);
const fmtDay = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '—';

const RULES = `Ti si pomoćnik na poslovnom pultu obrta Elink ICT (Bruno Matošević, Split; videonadzor, vatrodojava, parking sustavi, mreže). Odgovaraj na hrvatskom, kratko i konkretno, u običnom tekstu bez Markdowna. Koristi ISKLJUČIVO podatke ispod; ako nešto nije u podacima, reci da pult to ne prikazuje. Ne izmišljaj iznose ni datume. Termine u kalendar možeš dodati alatom dodaj_termin; nakon dodavanja kratko potvrdi datum i vrijeme. Opomene za račune šalju se klikom na gumb Opomeni u tablici računa, ne preko chata.

PODACI S PULTA:
`;

/** Tekstualni sažetak trenutnog stanja pulta za model. */
export function buildContext({ dashboard, mail, calendar }) {
  const L = [];
  L.push(`Danas je ${new Date().toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`);

  if (dashboard) {
    const dueSum = dashboard.due.reduce((a, d) => a + d.amount, 0);
    L.push(`\nRAČUNI ZA NAPLATITI (${dashboard.due.length}, ukupno ${fmtEUR(dueSum)}):`);
    for (const d of dashboard.due) {
      L.push(`- ${d.no} | ${d.client} | ${fmtEUR(d.amount)} | rok ${fmtDay(d.rok)}${d.late > 0 ? ` | KASNI ${d.late} dana` : ''}`);
    }
    if (dashboard.cancelled.length) {
      L.push(`Poništeno stornom: ${dashboard.cancelled.map((c) => `${c.racun}↔${c.storno}`).join(', ')}`);
    }
    L.push(`\nZA FAKTURIRATI (${dashboard.toInvoice.length}):`);
    for (const j of dashboard.toInvoice) {
      L.push(`- ${j.client} – ${j.proj}${j.val ? ` | ${fmtEUR(j.val)}` : ' | iznos nije upisan'} | ${j.desc}`);
    }
    L.push(`\nOTVORENI POSLOVI (${dashboard.open.length}):`);
    for (const j of dashboard.open) {
      L.push(`- #${j.id} ${j.client} – ${j.proj} | ${j.status}${j.val ? ` | ${fmtEUR(j.val)}` : ''}${j.rok ? ` | rok ${fmtDay(j.rok)}` : ''} | ${j.desc}`);
    }
    L.push(`\nNAPLAĆENO UKUPNO: ${fmtEUR(dashboard.income.paidTotal)}`);
  }

  if (mail) {
    L.push(`\nINBOX zadnjih 7 dana (${mail.length}):`);
    for (const m of mail.slice(0, 25)) {
      const when = m.date ? new Date(m.date).toLocaleDateString('hr-HR') : '';
      L.push(`- ${when} | ${m.cat} | ${m.unread ? 'NEPROČITANO | ' : ''}${m.sender.replace(/<.*>/, '').trim()} | ${m.subject} | ${m.snippet.slice(0, 120)}`);
    }
  }

  if (calendar) {
    L.push('\nKALENDAR sljedećih 7 dana:');
    for (const day of calendar.days) {
      for (const ev of day.items) {
        const t = ev.allDay ? 'cijeli dan' : new Date(ev.start).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
        L.push(`- ${fmtDay(day.date)} ${t} | ${ev.title}${ev.loc ? ` | ${ev.loc}` : ''}${ev.desc ? ` | ${ev.desc.slice(0, 100)}` : ''}`);
      }
    }
  }

  return L.join('\n').slice(0, 30_000);
}

let client = null;
const getClient = () => (client ??= new Anthropic({ apiKey: config.anthropic.apiKey }));

/**
 * Vodi razgovor i emitira događaje: {type:'text'|'tool'|'done'|'error'}.
 * @param {{auth: object, context: string, messages: Array<{role: string, content: string}>, signal?: AbortSignal}} opts
 */
export async function* streamChat({ auth, context, messages, signal }) {
  const dodajTermin = betaZodTool({
    name: 'dodaj_termin',
    description:
      'Dodaje termin u korisnikov Google Kalendar. Koristi kad korisnik traži da se nešto zakaže ili doda u kalendar. Ako trajanje nije zadano, pretpostavi 1 sat.',
    inputSchema: z.object({
      naslov: z.string().describe('Naslov termina'),
      pocetak: z.string().describe('Početak, ISO 8601 s pomakom, npr. 2026-09-15T12:00:00+02:00'),
      kraj: z.string().describe('Kraj, ISO 8601 s pomakom'),
      lokacija: z.string().optional(),
      opis: z.string().optional(),
    }),
    run: async ({ naslov, pocetak, kraj, lokacija, opis }) => {
      const ev = await createEvent(auth, {
        summary: naslov,
        start: pocetak,
        end: kraj,
        location: lokacija,
        description: opis,
      });
      return JSON.stringify({ ok: true, naslov: ev.summary, pocetak: ev.start?.dateTime, kraj: ev.end?.dateTime, link: ev.link });
    },
  });

  const runner = getClient().beta.messages.toolRunner({
    model: config.anthropic.model,
    max_tokens: 4096,
    output_config: { effort: 'low' },
    system: RULES + context,
    tools: [dodajTermin],
    messages,
    stream: true,
  });

  try {
    for await (const messageStream of runner) {
      for await (const event of messageStream) {
        if (signal?.aborted) {
          runner.abort?.();
          return;
        }
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          yield { type: 'tool', name: event.content_block.name };
        } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text };
        }
      }
    }
    yield { type: 'done' };
  } catch (e) {
    yield { type: 'error', message: e?.message || 'Greška u razgovoru.', status: e?.status };
  }
}
