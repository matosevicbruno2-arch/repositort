import express from 'express';
import { google } from 'googleapis';
import { config, SCOPES } from './config.js';
import { openStore } from './lib/store.js';
import { newToken } from './lib/crypto.js';

export const store = openStore(config.dbPath, config.encryptionKey);

const baseClient = () =>
  new google.auth.OAuth2(config.google.clientId, config.google.clientSecret, config.google.redirectUri);

/** OAuth klijent vezan uz sesiju u pregledniku; sam osvježava access token. */
export function oauthClient(req) {
  if (req?.googleAuth) return req.googleAuth;
  const client = baseClient();
  if (req?.session?.tokens) client.setCredentials(req.session.tokens);
  client.on('tokens', (tokens) => {
    if (!req.session) return;
    // refresh_token stiže samo pri prvom pristanku — ne pregazi ga praznim
    req.session.tokens = { ...req.session.tokens, ...tokens };
    if (tokens.refresh_token && req.session.user?.email) {
      store.saveUser(req.session.user.email, tokens.refresh_token);
    }
  });
  return client;
}

/** OAuth klijent iz trajno pohranjenog refresh tokena — za aplikaciju i pozadinske provjere. */
export function clientForUser(email) {
  const refreshToken = store.getRefreshToken(email);
  if (!refreshToken) return null;
  const client = baseClient();
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

function emailAllowed(email) {
  if (!config.allowedEmails.length) return true;
  return config.allowedEmails.includes(String(email || '').toLowerCase());
}

/**
 * Prihvaća oba načina prijave: kolačić sesije (preglednik) i
 * `Authorization: Bearer` (iOS aplikacija).
 */
export function requireAuth(req, res, next) {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '')?.[1];
  if (bearer) {
    const email = store.emailForAppToken(bearer.trim());
    const client = email ? clientForUser(email) : null;
    if (!client) {
      return res
        .status(401)
        .json({ error: { code: 'needs_reauth', message: 'Prijava aplikacije je istekla — prijavi se ponovno.' } });
    }
    req.googleAuth = client;
    req.userEmail = email;
    return next();
  }
  if (req.session?.tokens?.access_token || req.session?.tokens?.refresh_token) {
    req.userEmail = req.session.user?.email || req.sessionID;
    return next();
  }
  res.status(401).json({ error: { code: 'not_authenticated', message: 'Prijava je potrebna.' } });
}

export const authRouter = express.Router();

authRouter.get('/google', (req, res) => {
  const client = baseClient();
  const state = `${newToken()}${req.query.mode === 'app' ? '.app' : ''}`;
  req.session.oauthState = state;
  res.redirect(
    client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent', // uvijek vrati refresh_token
      scope: SCOPES,
      include_granted_scopes: true,
      state,
    }),
  );
});

authRouter.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const forApp = String(state || '').endsWith('.app');
  const fail = (razlog) =>
    forApp ? res.redirect(`${config.appScheme}://auth?greska=${razlog}`) : res.redirect(`/?prijava=${razlog}`);

  if (error) return fail('odbijena');
  if (!code || !state || state !== req.session.oauthState) return fail('neispravna');
  delete req.session.oauthState;

  try {
    const client = baseClient();
    const { tokens } = await client.getToken(String(code));
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();

    if (!emailAllowed(data.email)) {
      req.session.destroy(() => {});
      return fail('zabranjena');
    }
    store.saveUser(data.email, tokens.refresh_token);

    if (forApp) {
      // Aplikacija se vraća preko vlastite sheme i dalje se javlja s tokenom.
      if (!tokens.refresh_token && !store.getRefreshToken(data.email)) return fail('bez_tokena');
      const token = store.issueAppToken(data.email, newToken());
      return res.redirect(`${config.appScheme}://auth?token=${encodeURIComponent(token)}`);
    }

    req.session.tokens = tokens;
    req.session.user = { email: data.email, name: data.name || data.email, picture: data.picture };
    res.redirect('/');
  } catch (e) {
    console.error('OAuth callback nije uspio:', e.message);
    fail('greska');
  }
});

authRouter.post('/odjava', (req, res) => {
  const bearer = /^Bearer\s+(.+)$/i.exec(req.get('authorization') || '')?.[1];
  if (bearer) {
    store.revokeAppToken(bearer.trim());
    return res.json({ ok: true });
  }
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/ja', (req, res) => {
  res.json({
    prijavljen: Boolean(req.session?.tokens),
    korisnik: req.session?.user || null,
    chat: config.anthropic.enabled,
    sheetUrl: `https://docs.google.com/spreadsheets/d/${config.sheetId}/edit`,
    sheetNaziv: 'Google tablica',
    potpis: config.sender,
  });
});
