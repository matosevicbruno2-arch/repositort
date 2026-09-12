import { google } from 'googleapis';
import { config } from '../config.js';

/** Pravila kategorizacije — provjeravaju se nad pošiljateljem i predmetom. */
const RULES = {
  upozorenja: [/payment failed/, /sigurnosno upozorenje/, /security alert/, /neuspje/, /opomen/, /dugovanj/, /suspend/],
  financije: [/erstebank/, /solo\.com\.hr/, /starlink/, /t\.ht\.hr/, /eracun/, /račun/, /racun/, /invoice/, /uplat/, /banking/, /paypal/, /revolut/, /porezna/],
  ostalo: [/newsletter/, /noreply@email\.openai/, /voyo/, /alex\.shop/, /algebra\.hr/, /shopify/, /no-reply@accounts\.google/, /unsubscribe/, /popust/, /marketing/],
};

export function categorize(sender, subject, snippet) {
  const s = `${sender} ${subject}`.toLowerCase();
  for (const re of RULES.upozorenja) if (re.test(s)) return 'upozorenja';
  for (const re of RULES.financije) if (re.test(s)) return 'financije';
  for (const re of RULES.ostalo) if (re.test(s) || re.test(String(snippet || '').toLowerCase())) return 'ostalo';
  return 'klijenti';
}

const header = (msg, name) =>
  (msg.payload?.headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

/** Obrađuje obećanja u serijama, da se ne otvori 40 istovremenih zahtjeva. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }),
  );
  return out;
}

function toMessage(m) {
  return {
    id: m.id,
    subject: header(m, 'Subject') || '(bez predmeta)',
    sender: header(m, 'From'),
    toRecipients: header(m, 'To')
      .split(',')
      .map((s) => (/<([^>]+)>/.exec(s)?.[1] || s).trim())
      .filter(Boolean),
    date: header(m, 'Date') ? new Date(header(m, 'Date')).toISOString() : new Date(Number(m.internalDate || 0)).toISOString(),
    labelIds: m.labelIds || [],
    snippet: m.snippet || '',
  };
}

async function fetchThreads(auth, query, pageSize) {
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.threads.list({ userId: 'me', q: query, maxResults: pageSize });
  const ids = (list.data.threads || []).map((t) => t.id);

  return mapLimit(ids, 6, async (id) => {
    const { data } = await gmail.users.threads.get({
      userId: 'me',
      id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Date'],
    });
    return { id, messages: (data.messages || []).map(toMessage) };
  });
}

/** Inbox za pult: jedan redak po razgovoru, najnovija poruka je vidljiva. */
export async function loadInbox(auth) {
  const threads = await fetchThreads(auth, config.gmailQuery, config.gmailMaxThreads);

  return threads
    .map((t) => {
      const msgs = [...t.messages].sort((a, b) => new Date(b.date) - new Date(a.date));
      const last = msgs[0] || {};
      const shown = msgs.find((m) => m.labelIds.includes('INBOX')) || last;
      const sender = shown.sender || '';
      const subject = shown.subject || last.subject || '(bez predmeta)';
      return {
        id: t.id,
        sender,
        subject,
        snippet: shown.snippet || '',
        date: shown.date || last.date || null,
        unread: msgs.some((m) => m.labelIds.includes('UNREAD')),
        count: msgs.length,
        cat: categorize(sender, subject, shown.snippet || ''),
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/** Traži adresu klijenta i povijest Solo opomena za zadani broj računa. */
export async function lookupInvoiceContact(auth, invoiceNo) {
  const threads = await fetchThreads(auth, `from:noreply@solo.com.hr subject:"${invoiceNo}"`, 10);
  const msgs = threads.flatMap((t) => t.messages).sort((a, b) => new Date(b.date) - new Date(a.date));
  const addresses = [...new Set(msgs.flatMap((m) => m.toRecipients))];
  const soloReminders = msgs
    .filter((m) => /dugovanj|opomen/i.test(m.subject || ''))
    .map((m) => m.date);
  return { addresses, soloReminders, found: msgs.length > 0 };
}

/** RFC 2822 poruka s UTF-8 sadržajem, base64url kodirana za Gmail API. */
function buildRaw({ to, subject, body, from }) {
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`;
  const lines = [
    from ? `From: ${from}` : null,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    Buffer.from(body, 'utf8').toString('base64'),
  ].filter((l) => l !== null);
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export async function sendReminder(auth, { to, subject, body, draft = false }) {
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = buildRaw({ to, subject, body });

  if (draft) {
    const { data } = await gmail.users.drafts.create({ userId: 'me', requestBody: { message: { raw } } });
    return { draftId: data.id, threadId: data.message?.threadId };
  }
  const { data } = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { messageId: data.id, threadId: data.threadId };
}
