import express from 'express';
import { google } from 'googleapis';
import { config, SCOPES } from './config.js';

/** OAuth klijent vezan uz sesiju; sam osvježava access token. */
export function oauthClient(req) {
  const client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
  if (req?.session?.tokens) client.setCredentials(req.session.tokens);
  client.on('tokens', (tokens) => {
    if (!req.session) return;
    // refresh_token stiže samo pri prvom pristanku — ne pregazi ga praznim.
    req.session.tokens = { ...req.session.tokens, ...tokens };
  });
  return client;
}

export function requireAuth(req, res, next) {
  if (req.session?.tokens?.access_token || req.session?.tokens?.refresh_token) return next();
  res.status(401).json({ error: { code: 'not_authenticated', message: 'Prijava je potrebna.' } });
}

function emailAllowed(email) {
  if (!config.allowedEmails.length) return true;
  return config.allowedEmails.includes(String(email || '').toLowerCase());
}

export const authRouter = express.Router();

authRouter.get('/google', (req, res) => {
  const client = oauthClient(req);
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
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
  if (error) return res.redirect('/?prijava=odbijena');
  if (!code || !state || state !== req.session.oauthState) {
    return res.redirect('/?prijava=neispravna');
  }
  delete req.session.oauthState;
  try {
    const client = oauthClient(req);
    const { tokens } = await client.getToken(String(code));
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();

    if (!emailAllowed(data.email)) {
      req.session.destroy(() => {});
      return res.redirect('/?prijava=zabranjena');
    }
    req.session.tokens = tokens;
    req.session.user = { email: data.email, name: data.name || data.email, picture: data.picture };
    res.redirect('/');
  } catch (e) {
    console.error('OAuth callback nije uspio:', e.message);
    res.redirect('/?prijava=greska');
  }
});

authRouter.post('/odjava', (req, res) => {
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
