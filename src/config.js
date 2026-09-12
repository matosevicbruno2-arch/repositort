import 'dotenv/config';

const required = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Nedostaje varijabla okruženja ${name} — vidi .env.example`);
  return v;
};

const list = (name) =>
  String(process.env[name] || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3000),
  baseUrl: process.env.BASE_URL || `http://localhost:${Number(process.env.PORT || 3000)}`,

  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    get redirectUri() {
      return process.env.GOOGLE_REDIRECT_URI || `${config.baseUrl}/auth/google/callback`;
    },
  },

  // Tablica "Elink ICT – Radovi i naplata"
  sheetId: required('SHEET_ID'),

  // Prazno = svatko tko se prijavi Google računom ima pristup.
  allowedEmails: list('ALLOWED_EMAILS'),

  session: {
    secret: required('SESSION_SECRET'),
    secure: process.env.NODE_ENV === 'production' && !process.env.INSECURE_COOKIES,
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-opus-5',
    get enabled() {
      return Boolean(config.anthropic.apiKey);
    },
  },

  gmailQuery: process.env.GMAIL_QUERY || 'in:inbox newer_than:7d',
  gmailMaxThreads: Number(process.env.GMAIL_MAX_THREADS || 40),
  timeZone: process.env.TIME_ZONE || 'Europe/Zagreb',
  calendarDays: Number(process.env.CALENDAR_DAYS || 7),

  // Potpis ispod opomene
  sender: {
    name: process.env.SENDER_NAME || 'Bruno Matošević',
    company: process.env.SENDER_COMPANY || 'ELINK ICT, vl. Bruno Matošević',
    phone: process.env.SENDER_PHONE || '091 280 0903',
    email: process.env.SENDER_EMAIL || '',
  },

  cacheTtlMs: Number(process.env.CACHE_TTL_MS || 60_000),
};

export const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
];
