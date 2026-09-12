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
      last_used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sent_notifications (
      key TEXT PRIMARY KEY,
      sent_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS devices_email ON devices(email);
    CREATE INDEX IF NOT EXISTS app_tokens_email ON app_tokens(email);
  `);

  const now = () => Date.now();

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

    issueAppToken(email, token) {
      db.prepare('INSERT OR REPLACE INTO app_tokens (token_hash, email, created_at) VALUES (?, ?, ?)').run(
        hashToken(token),
        email,
        now(),
      );
      return token;
    },

    emailForAppToken(token) {
      const hash = hashToken(token);
      const row = db.prepare('SELECT email FROM app_tokens WHERE token_hash = ?').get(hash);
      if (!row) return null;
      db.prepare('UPDATE app_tokens SET last_used_at = ? WHERE token_hash = ?').run(now(), hash);
      return row.email;
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

    removeDevice(deviceToken) {
      db.prepare('DELETE FROM devices WHERE device_token = ?').run(deviceToken);
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
