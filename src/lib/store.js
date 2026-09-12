import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { decrypt, encrypt, hashToken } from './crypto.js';

/**
 * Trajna pohrana (SQLite, bez vanjskih ovisnosti).
 *
 * Potrebna je zbog push obavijesti: poslužitelj mora doći do tablice i kad nitko
 * nije prijavljen, pa se refresh token čuva ovdje — šifriran ključem iz okruženja.
 */
export function openStore(file, secret) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      email TEXT PRIMARY KEY,
      refresh_token TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS devices (
      device_token TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_tokens (
      token_hash TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sent_notifications (
      key TEXT PRIMARY KEY,
      sent_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS devices_email ON devices(email);
    CREATE INDEX IF NOT EXISTS app_tokens_email ON app_tokens(email);
  `);

  const now = () => Date.now();

  // Baze nastale prije uvođenja isteka tokena dobivaju stupac naknadno.
  const stupci = db.prepare('PRAGMA table_info(app_tokens)').all().map((r) => r.name);
  if (!stupci.includes('expires_at')) db.exec('ALTER TABLE app_tokens ADD COLUMN expires_at INTEGER');

  /** Token aplikacije vrijedi ograničeno; ukradeni token tako ne vrijedi zauvijek. */
  const TRAJANJE_TOKENA_MS = 180 * 24 * 3600 * 1000;

  return {
    db,
    close: () => db.close(),

    /** Refresh token stiže samo pri prvom pristanku — kasnije ga ne pregazi praznim. */
    saveUser(email, refreshToken) {
      if (refreshToken) {
        db.prepare(
          `INSERT INTO users (email, refresh_token, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(email) DO UPDATE SET refresh_token = excluded.refresh_token, updated_at = excluded.updated_at`,
        ).run(email, encrypt(refreshToken, secret), now());
      } else {
        db.prepare(
          `INSERT INTO users (email, refresh_token, updated_at) VALUES (?, NULL, ?)
           ON CONFLICT(email) DO UPDATE SET updated_at = excluded.updated_at`,
        ).run(email, now());
      }
    },

    getRefreshToken(email) {
      const row = db.prepare('SELECT refresh_token FROM users WHERE email = ?').get(email);
      return row?.refresh_token ? decrypt(row.refresh_token, secret) : null;
    },

    listUsersWithToken() {
      return db
        .prepare('SELECT email FROM users WHERE refresh_token IS NOT NULL ORDER BY email')
        .all()
        .map((r) => r.email);
    },

    issueAppToken(email, token, trajanjeMs = TRAJANJE_TOKENA_MS) {
      db.prepare(
        'INSERT OR REPLACE INTO app_tokens (token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)',
      ).run(hashToken(token), email, now(), now() + trajanjeMs);
      return token;
    },

    emailForAppToken(token) {
      const hash = hashToken(token);
      const row = db.prepare('SELECT email, expires_at FROM app_tokens WHERE token_hash = ?').get(hash);
      if (!row) return null;
      if (row.expires_at != null && row.expires_at < now()) {
        db.prepare('DELETE FROM app_tokens WHERE token_hash = ?').run(hash);
        return null;
      }
      db.prepare('UPDATE app_tokens SET last_used_at = ? WHERE token_hash = ?').run(now(), hash);
      return row.email;
    },

    /** Poništava sve tokene korisnika — koristi se kad izgubi pristup. */
    revokeAllAppTokens(email) {
      db.prepare('DELETE FROM app_tokens WHERE email = ?').run(email);
    },

    revokeAppToken(token) {
      db.prepare('DELETE FROM app_tokens WHERE token_hash = ?').run(hashToken(token));
    },

    registerDevice(email, deviceToken) {
      db.prepare(
        `INSERT INTO devices (device_token, email, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(device_token) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`,
      ).run(deviceToken, email, now());
    },

    devicesFor(email) {
      return db.prepare('SELECT device_token FROM devices WHERE email = ?').all(email).map((r) => r.device_token);
    },

    /** Bez e-maila briše bilo koji uređaj — samo za čišćenje kad ga APNs odbije. */
    removeDevice(deviceToken) {
      db.prepare('DELETE FROM devices WHERE device_token = ?').run(deviceToken);
    },

    /** Iz zahtjeva se smije brisati samo vlastiti uređaj. */
    removeDeviceForUser(email, deviceToken) {
      const r = db.prepare('DELETE FROM devices WHERE device_token = ? AND email = ?').run(deviceToken, email);
      return r.changes > 0;
    },

    /** Vraća true samo prvi put za dani ključ — sprječava ponavljanje iste obavijesti. */
    markNotified(key) {
      const existing = db.prepare('SELECT 1 FROM sent_notifications WHERE key = ?').get(key);
      if (existing) return false;
      db.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?)').run(key, now());
      return true;
    },

    /** Čisti zapise starije od zadanog broja dana, da baza ne raste bez kraja. */
    pruneNotifications(days = 90) {
      db.prepare('DELETE FROM sent_notifications WHERE sent_at < ?').run(now() - days * 86_400_000);
    },
  };
}
