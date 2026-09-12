import { google } from 'googleapis';
import { config } from '../config.js';
import { isoDay, startOfToday } from '../lib/parse.js';

const isoLocal = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
};

const stripHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Termini sljedećih N dana, razvrstani po danima (višednevni se ponavljaju). */
export async function loadCalendar(auth) {
  const calendar = google.calendar({ version: 'v3', auth });
  const today = startOfToday();
  const end = new Date(today);
  end.setDate(end.getDate() + config.calendarDays);

  const { data } = await calendar.events.list({
    calendarId: 'primary',
    timeMin: isoLocal(today),
    timeMax: isoLocal(end),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
    timeZone: config.timeZone,
  });

  const days = Array.from({ length: config.calendarDays }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    return { date: isoDay(d), items: [] };
  });
  const byDate = new Map(days.map((d) => [d.date, d]));

  for (const ev of data.items || []) {
    if (ev.status === 'cancelled') continue;
    const allDay = Boolean(ev.start?.date && !ev.start?.dateTime);
    const start = allDay ? new Date(`${ev.start.date}T00:00:00`) : new Date(ev.start?.dateTime);
    if (Number.isNaN(start.getTime())) continue;
    const endAt = ev.end ? (allDay ? new Date(`${ev.end.date}T00:00:00`) : new Date(ev.end.dateTime)) : null;

    const item = {
      allDay,
      start: start.toISOString(),
      end: endAt ? endAt.toISOString() : null,
      title: ev.summary || '(bez naslova)',
      loc: ev.location || '',
      desc: stripHtml(ev.description),
      link: ev.htmlLink || null,
    };

    // višednevni termin ide na svaki dan koji pokriva unutar prozora
    const cur = new Date(start);
    cur.setHours(0, 0, 0, 0);
    const last = endAt ? new Date(endAt) : new Date(cur);
    if (allDay && endAt) last.setDate(last.getDate() - 1); // kraj cjelodnevnog je ekskluzivan
    last.setHours(0, 0, 0, 0);

    for (let d = new Date(cur); d <= last; d.setDate(d.getDate() + 1)) {
      byDate.get(isoDay(d))?.items.push(item);
    }
  }

  for (const day of days) {
    day.items.sort((a, b) => (a.allDay ? -1 : b.allDay ? 1 : new Date(a.start) - new Date(b.start)));
  }
  return { days, total: days.reduce((a, d) => a + d.items.length, 0) };
}

export async function createEvent(auth, { summary, start, end, location, description }) {
  const calendar = google.calendar({ version: 'v3', auth });
  const { data } = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: {
      summary,
      location: location || undefined,
      description: description || undefined,
      start: { dateTime: start, timeZone: config.timeZone },
      end: { dateTime: end, timeZone: config.timeZone },
    },
  });
  return { id: data.id, summary: data.summary, start: data.start, end: data.end, link: data.htmlLink };
}
