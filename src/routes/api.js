import express from 'express';
import { config } from '../config.js';
import { oauthClient, requireAuth, store } from '../auth.js';
import { cached, drop, storedAt } from '../lib/cache.js';
import { appendJob, loadDashboard } from '../services/sheets.js';
import { validateJob } from '../lib/newjob.js';
import { loadInbox, lookupInvoiceContact, sendReminder } from '../services/gmail.js';
import { createEvent, loadCalendar } from '../services/calendar.js';
import { buildContext, streamChat } from '../services/chat.js';

export const apiRouter = express.Router();
apiRouter.use(requireAuth);

const keyOf = (req, name) => `${req.userEmail || req.sessionID}:${name}`;

/** Prevodi greške Google API-ja u poruke koje pult zna prikazati. */
function fail(res, e, izvor) {
  const status = e?.status || e?.code;
  if (status === 401 || status === 403) {
    const invalidGrant = /invalid_grant|Token has been expired|invalid_token/i.test(e?.message || '');
    return res.status(status === 403 ? 403 : 401).json({
      error: {
        code: invalidGrant || status === 401 ? 'needs_reauth' : 'forbidden',
        message:
          invalidGrant || status === 401
            ? `Pristup ${izvor} je istekao — prijavi se ponovno.`
            : `Google je odbio pristup ${izvor}. Provjeri jesu li dopuštenja odobrena pri prijavi.`,
      },
    });
  }
  if (e?.code === 'sheet_structure') {
    return res.status(422).json({ error: { code: 'sheet_structure', message: e.message } });
  }
  if (status === 404) {
    return res.status(404).json({
      error: { code: 'not_found', message: `Izvor ${izvor} nije pronađen — provjeri SHEET_ID.` },
    });
  }
  console.error(`[${izvor}]`, e?.message || e);
  return res.status(502).json({
    error: { code: 'upstream', message: `${izvor} trenutno ne odgovara. ${e?.message || ''}`.trim() },
  });
}

/** Zajednički obrazac za tri izvora podataka pulta. */
function dataRoute(path, name, izvor, loader) {
  apiRouter.get(path, async (req, res) => {
    const key = keyOf(req, name);
    try {
      const data = await cached(key, config.cacheTtlMs, () => loader(oauthClient(req)), {
        refresh: req.query.refresh === '1',
      });
      res.json({ data, storedAt: storedAt(key) });
    } catch (e) {
      fail(res, e, izvor);
    }
  });
}

dataRoute('/pult', 'pult', 'Google tablice', loadDashboard);
dataRoute('/inbox', 'inbox', 'Gmaila', loadInbox);
dataRoute('/kalendar', 'kalendar', 'Google kalendara', loadCalendar);

apiRouter.post('/osvjezi', (req, res) => {
  drop(`${req.userEmail || req.sessionID}:`);
  res.json({ ok: true });
});

/** Adresa klijenta i povijest Solo opomena za račun. */
apiRouter.get('/racun/:broj/kontakt', async (req, res) => {
  try {
    res.json({ data: await lookupInvoiceContact(oauthClient(req), req.params.broj) });
  } catch (e) {
    fail(res, e, 'Gmaila');
  }
});

apiRouter.post('/opomena', async (req, res) => {
  const { to, subject, body, draft } = req.body || {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(to || ''))) {
    return res.status(400).json({ error: { code: 'bad_email', message: 'Upiši ispravnu e-mail adresu klijenta.' } });
  }
  if (!String(subject || '').trim() || !String(body || '').trim()) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Predmet i tekst ne smiju biti prazni.' } });
  }
  try {
    const result = await sendReminder(oauthClient(req), { to, subject, body, draft: Boolean(draft) });
    drop(keyOf(req, 'inbox'));
    res.json({ data: result });
  } catch (e) {
    fail(res, e, 'Gmaila');
  }
});

apiRouter.post('/termin', async (req, res) => {
  const { naslov, pocetak, kraj, lokacija, opis } = req.body || {};
  if (!naslov || !pocetak || !kraj) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Naslov, početak i kraj su obavezni.' } });
  }
  try {
    const data = await createEvent(oauthClient(req), {
      summary: naslov,
      start: pocetak,
      end: kraj,
      location: lokacija,
      description: opis,
    });
    drop(keyOf(req, 'kalendar'));
    res.json({ data });
  } catch (e) {
    fail(res, e, 'Google kalendara');
  }
});

/** Upis novog posla u tablicu — unos s terena iz aplikacije ili preglednika. */
apiRouter.post('/posao', async (req, res) => {
  const { ok, greske, posao } = validateJob(req.body);
  if (!ok) {
    return res.status(400).json({ error: { code: 'bad_request', message: greske.join(' ') } });
  }
  try {
    const data = await appendJob(oauthClient(req), posao);
    drop(keyOf(req, 'pult'));
    res.status(201).json({ data });
  } catch (e) {
    fail(res, e, 'Google tablice');
  }
});

/** Registracija iOS uređaja za push obavijesti. */
apiRouter.post('/uredjaj', (req, res) => {
  const token = String(req.body?.token || '').trim();
  if (!/^[0-9a-f]{64,200}$/i.test(token)) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Neispravan token uređaja.' } });
  }
  if (!req.userEmail) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Korisnik nije poznat.' } });
  }
  store.registerDevice(req.userEmail, token);
  res.json({ data: { registriran: true, push: config.apns.enabled } });
});

apiRouter.delete('/uredjaj/:token', (req, res) => {
  store.removeDevice(req.params.token);
  res.json({ data: { uklonjen: true } });
});

/** Razgovor s Claudeom o stanju pulta — odgovor stiže kao SSE tok. */
apiRouter.post('/chat', async (req, res) => {
  if (!config.anthropic.enabled) {
    return res.status(503).json({ error: { code: 'chat_disabled', message: 'Chat nije uključen — postavi ANTHROPIC_API_KEY.' } });
  }
  const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-12) : [];
  if (!messages.length) {
    return res.status(400).json({ error: { code: 'bad_request', message: 'Nema poruka.' } });
  }

  const auth = oauthClient(req);
  const email = req.userEmail || req.sessionID;

  // Kontekst se gradi iz istih podataka koje pult prikazuje; izvor koji padne se preskače.
  const settle = (p) => p.then((v) => v, () => null);
  const [dashboard, mail, calendar] = await Promise.all([
    settle(cached(`${email}:pult`, config.cacheTtlMs, () => loadDashboard(auth))),
    settle(cached(`${email}:inbox`, config.cacheTtlMs, () => loadInbox(auth))),
    settle(cached(`${email}:kalendar`, config.cacheTtlMs, () => loadCalendar(auth))),
  ]);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  try {
    for await (const ev of streamChat({
      auth,
      context: buildContext({ dashboard, mail, calendar }),
      messages,
      signal: controller.signal,
    })) {
      send(ev);
      if (ev.type === 'tool') drop(`${email}:kalendar`);
    }
  } catch (e) {
    send({ type: 'error', message: e?.message || 'Greška u razgovoru.' });
  } finally {
    res.end();
  }
});
