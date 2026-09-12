import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import { config } from './config.js';
import { authRouter, clientForUser, store } from './auth.js';
import { apiRouter } from './routes/api.js';
import { startNotifier } from './services/notifier.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(
  session({
    name: 'elink.sid',
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.session.secure,
      maxAge: 30 * 24 * 3600 * 1000,
    },
  }),
);

app.use('/auth', authRouter);
app.use('/api', apiRouter);
app.use(express.static(path.join(here, '..', 'public'), { maxAge: '1h', index: 'index.html' }));

app.get('/zdravlje', (_req, res) => res.json({ ok: true }));

app.use((err, _req, res, _next) => {
  console.error('Neuhvaćena greška:', err);
  if (res.headersSent) return res.end();
  res.status(500).json({ error: { code: 'internal', message: 'Neočekivana greška poslužitelja.' } });
});

app.listen(config.port, () => {
  console.log(`Elink ICT pult sluša na ${config.baseUrl}`);
  if (!config.anthropic.enabled) console.log('Chat je isključen (nema ANTHROPIC_API_KEY).');
  if (!config.allowedEmails.length) console.log('Upozorenje: ALLOWED_EMAILS je prazan — prijaviti se može bilo koji Google račun.');
  if (config.apns.enabled) {
    startNotifier({ store, clientForUser });
    console.log(`Push obavijesti uključene (provjera svakih ${Math.round(config.notifyIntervalMs / 60000)} min).`);
  } else {
    console.log('Push obavijesti isključene (nedostaju APNS_* postavke).');
  }
});
