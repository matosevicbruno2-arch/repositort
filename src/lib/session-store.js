import session from 'express-session';

/**
 * Sesije preglednika u SQLite-u umjesto u memoriji.
 *
 * Bez ovoga svaka objava na poslužitelj izbaci korisnika iz preglednika, a
 * express-session i sam upozorava da memorijska pohrana ne ide u produkciju.
 */
export function createSessionStore(db, { cistiSvakihMs = 3600_000 } = {}) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      podaci TEXT NOT NULL,
      istice INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_istice ON sessions(istice);
  `);

  const trajanje = (sess) => {
    const ms = sess?.cookie?.originalMaxAge ?? sess?.cookie?.maxAge;
    // Zadani rok vrijedi samo kad kolačić uopće nema maxAge; negativan maxAge
    // znači da je sesija istekla i mora takva i ostati.
    return Date.now() + (typeof ms === 'number' ? ms : 30 * 24 * 3600 * 1000);
  };

  class SQLiteStore extends session.Store {
    get(sid, cb) {
      try {
        const row = db.prepare('SELECT podaci, istice FROM sessions WHERE sid = ?').get(sid);
        if (!row) return cb(null, null);
        if (row.istice < Date.now()) {
          db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
          return cb(null, null);
        }
        cb(null, JSON.parse(row.podaci));
      } catch (e) {
        cb(e);
      }
    }

    set(sid, sess, cb) {
      try {
        db.prepare(
          `INSERT INTO sessions (sid, podaci, istice) VALUES (?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET podaci = excluded.podaci, istice = excluded.istice`,
        ).run(sid, JSON.stringify(sess), trajanje(sess));
        cb?.(null);
      } catch (e) {
        cb?.(e);
      }
    }

    destroy(sid, cb) {
      try {
        db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        cb?.(null);
      } catch (e) {
        cb?.(e);
      }
    }

    /** Produžuje sesiju koja se koristi, bez prepisivanja sadržaja. */
    touch(sid, sess, cb) {
      try {
        db.prepare('UPDATE sessions SET istice = ? WHERE sid = ?').run(trajanje(sess), sid);
        cb?.(null);
      } catch (e) {
        cb?.(e);
      }
    }

    length(cb) {
      try {
        cb(null, db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n);
      } catch (e) {
        cb(e);
      }
    }

    clear(cb) {
      try {
        db.prepare('DELETE FROM sessions').run();
        cb?.(null);
      } catch (e) {
        cb?.(e);
      }
    }

    ocistiIstekle() {
      db.prepare('DELETE FROM sessions WHERE istice < ?').run(Date.now());
    }
  }

  const store = new SQLiteStore();
  const timer = setInterval(() => store.ocistiIstekle(), cistiSvakihMs);
  timer.unref?.();
  return store;
}
