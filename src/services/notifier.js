import { config } from '../config.js';
import { planNotifications } from '../lib/notifications.js';
import { loadDashboard } from './sheets.js';
import { buildNotification, sendToUser } from './push.js';

/**
 * Povremena provjera kasne li računi i istječu li rokovi, pa slanje push obavijesti.
 *
 * Radi i kad nitko nije prijavljen — koristi trajno pohranjen refresh token, zato
 * je pohrana uvjet za push.
 */
export async function runNotificationCheck({ store, clientForUser, now = new Date() } = {}) {
  if (!config.apns.enabled) return { skipped: 'apns_nije_podesen' };

  const emails = store.listUsersWithToken();
  const rezultat = { korisnika: emails.length, poslano: 0, preskoceno: 0, greske: [] };

  for (const email of emails) {
    const auth = clientForUser(email);
    if (!auth) continue;

    let dashboard;
    try {
      dashboard = await loadDashboard(auth);
    } catch (e) {
      rezultat.greske.push(`${email}: ${e.message}`);
      continue;
    }

    const plan = planNotifications(dashboard, { now });
    for (const obavijest of plan) {
      const kljuc = `${email}:${obavijest.key}`;
      if (!store.markNotified(kljuc)) {
        rezultat.preskoceno++;
        continue;
      }
      for (const niži of obavijest.alsoMark) store.markNotified(`${email}:${niži}`);

      const badge = dashboard.totals.overdueCount || undefined;
      const { sent } = await sendToUser(
        store,
        email,
        buildNotification({ naslov: obavijest.naslov, tekst: obavijest.tekst, badge, podaci: obavijest.podaci }),
      );
      rezultat.poslano += sent;
    }
  }

  store.pruneNotifications();
  return rezultat;
}

/** Pokreće provjeru u pravilnim razmacima; vraća funkciju za zaustavljanje. */
export function startNotifier({ store, clientForUser }) {
  if (!config.apns.enabled || !config.notifyIntervalMs) return () => {};

  const tick = async () => {
    try {
      const r = await runNotificationCheck({ store, clientForUser });
      if (r.poslano) console.log(`Push: poslano ${r.poslano} obavijesti.`);
      if (r.greske?.length) console.error('Push greške:', r.greske.join(' | '));
    } catch (e) {
      console.error('Provjera obavijesti nije uspjela:', e.message);
    }
  };

  const timer = setInterval(tick, config.notifyIntervalMs);
  timer.unref?.(); // ne drži proces budnim sam po sebi
  setTimeout(tick, 30_000).unref?.(); // prva provjera nakon pokretanja
  return () => clearInterval(timer);
}
