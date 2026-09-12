/* Elink ICT — poslovni pult. Podatke dohvaća s vlastitog poslužitelja (/api/*). */
'use strict';

const $ = (id) => document.getElementById(id);
const fmtEUR = (n) => new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n || 0);
const fmtEUR0 = (n) => new Intl.NumberFormat('hr-HR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n || 0);
const fmtTime = (ms) => new Date(ms).toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** 'YYYY-MM-DD' → Date u lokalnoj ponoći (bez pomaka vremenske zone). */
const day = (iso) => (iso ? new Date(`${iso}T00:00:00`) : null);
const fmtDay = (iso) => (day(iso) ? day(iso).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric' }) : '—');
const fmtDayY = (iso) => (day(iso) ? day(iso).toLocaleDateString('hr-HR', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '—');
const fmtClock = (d) => d.toLocaleTimeString('hr-HR', { hour: '2-digit', minute: '2-digit' });

const REFRESH_MS = 5 * 60 * 1000;
const snap = { due: [], cancelled: [], open: [], toInvoice: [], paidTotal: 0, mail: [], cal: [] };
const sentReminders = new Map();
let chatEnabled = false;

// ---------- stanje i indikatori ----------
function setState(id, html, kind) {
  const el = $(id);
  if (!html) { el.hidden = true; el.innerHTML = ''; el.className = 'state'; return; }
  el.hidden = false; el.innerHTML = html; el.className = 'state' + (kind ? ' ' + kind : '');
}
const setDot = (id, cls) => { $(id).className = 'dot' + (cls ? ' ' + cls : ''); };

// ---------- dohvat ----------
class AuthError extends Error {}

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: 'same-origin', ...options });
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body?.error?.code === 'not_authenticated' || body?.error?.code === 'needs_reauth') {
      throw new AuthError(body?.error?.message || 'Prijava je istekla.');
    }
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `Greška ${res.status}.`);
    err.code = body?.error?.code;
    throw err;
  }
  return body;
}

// ---------- pult (tablica) ----------
function renderPult({ data, storedAt }) {
  const { due, cancelled, open, toInvoice, income, totals } = data;
  snap.due = due; snap.cancelled = cancelled; snap.open = open; snap.toInvoice = toInvoice; snap.paidTotal = income.paidTotal;

  // KPI: za naplatiti
  $('k-due').textContent = fmtEUR(totals.dueSum);
  $('k-due-note').innerHTML = totals.overdueCount
    ? `<span class="crit">${totals.overdueCount} ${totals.overdueCount === 1 ? 'račun kasni' : 'računa kasne'}</span> · ${esc(fmtEUR(totals.dueOverdue))} preko roka`
    : `${due.length} otvorenih računa · ništa nije preko roka`;
  $('due-sub').textContent = `${due.length} računa`;

  // Tablica računa
  const tb = $('tbl-due').querySelector('tbody');
  tb.innerHTML = due.length
    ? due.map((d) => {
        let chip = '<span class="chip neutral">bez roka</span>';
        if (d.amount < 0) chip = '<span class="chip neutral">storno</span>';
        else if (d.late != null) {
          if (d.late > 0) chip = `<span class="chip crit">kasni ${d.late} d</span>`;
          else if (d.late >= -3) chip = `<span class="chip warn">rok ${d.late === 0 ? 'danas' : 'za ' + -d.late + ' d'}</span>`;
          else chip = `<span class="chip good">za ${-d.late} d</span>`;
        }
        const noCell = d.pdf
          ? `<a class="mono" href="${esc(d.pdf)}" target="_blank" rel="noopener" style="text-decoration:none;border-bottom:1px solid var(--line-strong)">${esc(d.no)}</a>`
          : `<span class="mono">${esc(d.no)}</span>`;
        const sent = sentReminders.get(d.no);
        const act = d.amount > 0
          ? (sent ? `<span class="chip good">opomena poslana ${esc(sent)}</span>` : `<button type="button" class="act${d.late > 0 ? ' crit' : ''}" data-rem="${esc(d.no)}">Opomeni</button>`)
          : '';
        return `<tr class="due-row" data-rem="${esc(d.no)}"><td>${noCell}</td><td class="client">${esc(d.client)}</td><td class="mono">${esc(fmtDay(d.rok))}</td><td>${chip} ${act}</td><td class="num mono">${esc(fmtEUR(d.amount))}</td></tr>`;
      }).join('')
    : '<tr><td colspan="5" class="desc">Nema računa za naplatiti.</td></tr>';

  if (cancelled.length) {
    tb.innerHTML += `<tr><td colspan="5" class="desc">Poništeno stornom (nije u popisu): ${cancelled
      .map((c) => `<span class="mono">${esc(c.racun)}</span> ↔ <span class="mono">${esc(c.storno)}</span> (${esc(fmtEUR(c.amount))})`)
      .join(' · ')}</td></tr>`;
  }

  // KPI: poslovi
  $('k-open').textContent = String(open.length);
  $('k-open-note').innerHTML = `procijenjena vrijednost <b>${esc(fmtEUR0(totals.openValue))}</b>`;
  $('open-sub').textContent = `${open.length} poslova`;

  // KPI: za fakturirati
  $('k-inv').textContent = String(toInvoice.length);
  $('k-inv-note').innerHTML = toInvoice.length
    ? `<b class="mono" style="font-size:13.5px">${esc(fmtEUR(totals.invoiceSum))}</b><br>${toInvoice.map((j) => esc(`${j.client} – ${j.proj}`)).join(' · ')}`
    : 'sve završeno je fakturirano';
  $('inv-sub').textContent = toInvoice.length
    ? `${toInvoice.length} ${toInvoice.length === 1 ? 'posao' : 'posla'}${totals.invoiceSum ? ' · ' + fmtEUR0(totals.invoiceSum) : ' · iznos nije upisan'}`
    : '';

  const todayMs = day(data.today).getTime();
  const ageDays = (iso) => (day(iso) ? Math.round((todayMs - day(iso).getTime()) / 86400000) : null);

  $('list-inv').innerHTML = toInvoice.length
    ? toInvoice.map((j) => {
        const ref = j.done || j.entered;
        const age = ageDays(ref);
        const chip = age != null && age > 14
          ? `<span class="chip warn">završeno prije ${age} d</span> `
          : (age != null ? `<span class="chip good">završeno ${fmtDay(ref)}</span> ` : '');
        const amount = j.val || j.toInv;
        return `<li><span class="t">${chip}${esc(j.client)} <span style="color:var(--ink-3)">·</span> ${esc(j.proj)}</span><span class="v">${amount ? '<b>' + esc(fmtEUR0(amount)) + '</b>' : '<span class="chip neutral">bez iznosa</span>'}</span><span class="d">${esc(j.desc)}${j.note ? ' — ' + esc(j.note) : ''}</span></li>`;
      }).join('') +
      (() => {
        const missing = toInvoice.filter((j) => !(j.val || j.toInv)).length;
        return `<li style="border-top:2px solid var(--ink);border-bottom:0;padding-top:9px"><span class="t">Ukupno za fakturirati</span><span class="v"><b style="font-family:'IBM Plex Sans Condensed',sans-serif;font-size:18px;font-weight:700">${esc(fmtEUR(totals.invoiceSum))}</b></span>${missing ? `<span class="d">${missing} ${missing === 1 ? 'posao nema upisan iznos' : 'posla nemaju upisan iznos'} — zbroj obuhvaća samo poslove s iznosom.</span>` : ''}</li>`;
      })()
    : '<li><span class="d">Sve što je završeno već je fakturirano.</span></li>';

  $('list-open').innerHTML = open.length
    ? open.map((j) => {
        let flag = '';
        if (j.prio === 'Hitno') flag = '<span class="chip crit">hitno</span> ';
        else if (j.prio === 'Visoko') flag = '<span class="chip warn">visoko</span> ';
        if (j.status !== 'Za napraviti') flag += `<span class="chip neutral">${esc(j.status)}</span> `;
        const age = ageDays(j.entered);
        const rokTxt = j.rok ? `rok ${fmtDay(j.rok)}` : (age != null ? `otvoreno ${age} d` : '');
        return `<li><span class="t">${flag}${esc(j.client)} <span style="color:var(--ink-3)">·</span> ${esc(j.proj)}</span><span class="v">${j.val ? '<b>' + esc(fmtEUR0(j.val)) + '</b><br>' : ''}${esc(rokTxt)}</span><span class="d">${esc(j.desc)}</span></li>`;
      }).join('')
    : '<li><span class="d">Nema otvorenih poslova.</span></li>';

  // Primici
  $('k-paid').textContent = fmtEUR0(income.paidTotal);
  const years = [...new Set(income.byMonth.map((m) => m.mjesec.slice(0, 4)))];
  const yearLabel = years.length ? years[years.length - 1] : String(new Date().getFullYear());
  $('k-paid-year').textContent = yearLabel;
  $('income-sub').textContent = `${years.join('–') || yearLabel} · €`;
  renderIncomeChart(income.byMonth);

  setState('state-drive', '');
  setDot('dot-drive', 'on');
  $('ts-drive').textContent = fmtTime(storedAt || Date.now());
}

function renderIncomeChart(entries) {
  const host = $('chart-income');
  if (!entries.length) { host.innerHTML = '<span class="desc">Nema primitaka u tablici.</span>'; return; }
  const MONTHS = ['sij', 'velj', 'ožu', 'tra', 'svi', 'lip', 'srp', 'kol', 'ruj', 'lis', 'stu', 'pro'];
  const W = 640, H = 170, padL = 8, padR = 8, padT = 22, padB = 24;
  const max = Math.max(...entries.map((e) => e.iznos));
  const step = max > 8000 ? 4000 : max > 4000 ? 2000 : 1000;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const n = entries.length, gap = 10;
  const bw = (W - padL - padR - gap * (n - 1)) / n;
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Primici po mjesecu">`;
  for (let g = step; g <= top; g += step) {
    s += `<line class="grid" x1="${padL}" x2="${W - padR}" y1="${y(g)}" y2="${y(g)}"/><text class="axis" x="${padL}" y="${y(g) - 3}">${g / 1000} k</text>`;
  }
  s += `<line class="base" x1="${padL}" x2="${W - padR}" y1="${y(0)}" y2="${y(0)}"/>`;
  entries.forEach(({ mjesec: key, iznos: val }, i) => {
    const x = padL + i * (bw + gap);
    const h = Math.max(0, y(0) - y(val));
    const last = i === n - 1;
    const m = MONTHS[+key.slice(5) - 1];
    s += `<rect class="bar${last ? ' last' : ''}" x="${x}" y="${y(val)}" width="${bw}" height="${h}" rx="3"><title>${m} ${key.slice(0, 4)}: ${fmtEUR(val)}</title></rect>`;
    s += `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${m}</text>`;
    if (last || val === max) s += `<text class="lbl" x="${x + bw / 2}" y="${y(val) - 5}" text-anchor="middle">${fmtEUR0(val)}</text>`;
  });
  host.innerHTML = s + '</svg>';
}

// ---------- inbox ----------
let mailItems = [];
let mailFilter = 'sve';

function renderInbox({ data, storedAt }) {
  mailItems = data.map((m) => ({ ...m, date: m.date ? new Date(m.date) : new Date(0) }));
  snap.mail = mailItems;
  drawMail();
  setState('state-gmail', '');
  setDot('dot-gmail', 'on');
  $('ts-gmail').textContent = fmtTime(storedAt || Date.now());
}

function drawMail() {
  const items = mailFilter === 'sve' ? mailItems : mailItems.filter((m) => m.cat === mailFilter);
  const counts = mailItems.reduce((a, m) => ((a[m.cat] = (a[m.cat] || 0) + 1), a), {});
  document.querySelectorAll('#mail-filters .chip').forEach((b) => {
    const c = b.dataset.cat;
    const n = c === 'sve' ? mailItems.length : counts[c] || 0;
    b.textContent = b.textContent.replace(/\s*\d+$/, '') + (mailItems.length ? ' ' + n : '');
    b.setAttribute('aria-pressed', String(c === mailFilter));
  });

  const now = new Date();
  $('list-mail').innerHTML = items.length
    ? items.map((m) => {
        const sameDay = m.date.toDateString() === now.toDateString();
        const when = sameDay ? fmtClock(m.date) : m.date.toLocaleDateString('hr-HR', { weekday: 'short', day: 'numeric', month: 'numeric' });
        const from = m.sender.replace(/<.*>/, '').trim() || m.sender;
        const chip = m.cat === 'upozorenja' ? '<span class="chip crit">upozorenje</span>'
          : m.cat === 'financije' ? '<span class="chip warn">financije</span>'
          : m.cat === 'klijenti' ? '<span class="chip accent">klijent</span>' : '';
        return `<li class="${m.unread ? 'unread ' : ''}cat-${m.cat}"><span class="stripe"></span><span><span class="from">${esc(from)}${m.count > 1 ? ' · ' + m.count : ''} ${chip}</span><a class="subj" href="https://mail.google.com/mail/u/0/#inbox/${esc(m.id)}" target="_blank" rel="noopener">${esc(m.subject)}</a><span class="snip">${esc(m.snippet)}</span></span><span class="when">${esc(when)}</span></li>`;
      }).join('')
    : '<li><span class="stripe"></span><span class="desc" style="color:var(--ink-2)">Nema poruka u ovoj kategoriji.</span><span></span></li>';
}

$('mail-filters').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cat]');
  if (!b) return;
  mailFilter = b.dataset.cat;
  drawMail();
});

// ---------- kalendar ----------
function renderKalendar({ data, storedAt }) {
  snap.cal = data.days;
  $('cal').innerHTML = data.days.map((d, i) => {
    const label = day(d.date).toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'numeric' });
    const body = d.items.length
      ? d.items.map((ev) => {
          const s = new Date(ev.start);
          const e = ev.end ? new Date(ev.end) : null;
          const t = ev.allDay ? 'cijeli dan' : fmtClock(s) + (e ? '–' + fmtClock(e) : '');
          const inner = `<span class="t mono">${esc(t)}</span><span class="w">${esc(ev.title)}</span>${ev.loc ? `<span class="l">${esc(ev.loc)}</span>` : ''}${ev.desc ? `<span class="l">${esc(ev.desc.slice(0, 120))}</span>` : ''}`;
          return ev.link
            ? `<a class="ev${ev.allDay ? ' allday' : ''}" href="${esc(ev.link)}" target="_blank" rel="noopener">${inner}</a>`
            : `<div class="ev${ev.allDay ? ' allday' : ''}">${inner}</div>`;
        }).join('')
      : '<div class="empty">—</div>';
    return `<div class="day${i === 0 ? ' today' : ''}"><h4><span>${esc(label)}</span>${i === 0 ? '<span>danas</span>' : ''}</h4>${body}</div>`;
  }).join('');

  document.querySelector('#panel-cal h2').textContent =
    `Kalendar · sljedećih 7 dana${data.total ? ` · ${data.total} ${data.total === 1 ? 'termin' : 'termina'}` : ' · nema termina'}`;
  setState('state-cal', '');
  setDot('dot-cal', 'on');
  $('ts-cal').textContent = fmtTime(storedAt || Date.now());
}

// ---------- učitavanje ----------
const loaded = { pult: false, inbox: false, kalendar: false };

async function load(section, path, render, izvor, { refresh = false } = {}) {
  const dot = { pult: 'dot-drive', inbox: 'dot-gmail', kalendar: 'dot-cal' }[section];
  const stateId = { pult: 'state-drive', inbox: 'state-gmail', kalendar: 'state-cal' }[section];
  setDot(dot, 'wait');
  try {
    const body = await api(path + (refresh ? '?refresh=1' : ''));
    render(body);
    loaded[section] = true;
    $('foot-ts').textContent = 'Zadnje osvježavanje ' + fmtTime(Date.now());
  } catch (e) {
    if (e instanceof AuthError) throw e;
    const hadData = loaded[section];
    setState(stateId, esc(e.message) + (hadData ? ' Prikazani su zadnji uspješno učitani podaci.' : ''), hadData ? 'warn' : 'err');
    setDot(dot, hadData ? 'wait' : 'err');
  }
}

async function loadAll({ refresh = false } = {}) {
  try {
    if (refresh) await api('/api/osvjezi', { method: 'POST' });
    await Promise.all([
      load('pult', '/api/pult', renderPult, 'tablice', { refresh }),
      load('inbox', '/api/inbox', renderInbox, 'Gmaila', { refresh }),
      load('kalendar', '/api/kalendar', renderKalendar, 'kalendara', { refresh }),
    ]);
    setState('page-state', '');
  } catch (e) {
    if (e instanceof AuthError) return showLogin('Prijava je istekla — prijavi se ponovno.');
    setState('page-state', esc(e.message), 'err');
  }
}

// ---------- opomena ----------
let remCur = null;
let sender = {};

function reminderText(d) {
  const late = d.late != null && d.late > 0 ? ` (kašnjenje ${d.late} ${d.late === 1 ? 'dan' : 'dana'})` : '';
  const potpis = ['Srdačan pozdrav,', sender.name, sender.company, [sender.phone && 'mob. ' + sender.phone, sender.email].filter(Boolean).join(' · ')]
    .filter(Boolean).join('\n');
  return `Poštovani,\n\npodsjećamo Vas da račun br. ${d.no}${d.date ? ' od ' + fmtDayY(d.date) : ''} na iznos ${fmtEUR(d.amount)}${d.rok ? ', s rokom plaćanja ' + fmtDayY(d.rok) : ''}, prema našoj evidenciji još nije podmiren${late}.\n\nMolimo Vas da iznos uplatite u najkraćem mogućem roku.${d.pdf ? '\nRačun (PDF): ' + d.pdf : ''}\n\nAko je uplata u međuvremenu izvršena, molimo zanemarite ovu poruku.\n\n${potpis}`;
}

function remStatus(text, cls) {
  const el = $('rem-status');
  el.textContent = text || '';
  el.className = 'note' + (cls ? ' ' + cls : '');
}

async function openReminder(no) {
  const d = snap.due.find((x) => x.no === no);
  if (!d) return;
  remCur = d;

  $('rem-title').textContent = `Opomena · račun ${d.no}`;
  $('rem-meta').innerHTML = `<span><b>${esc(d.client)}</b></span><span>${esc(fmtEUR(d.amount))}</span>${d.date ? `<span>izdan ${esc(fmtDayY(d.date))}</span>` : ''}${d.rok ? `<span>rok ${esc(fmtDayY(d.rok))}</span>` : ''}${d.late > 0 ? `<span style="color:var(--crit);font-weight:600">kasni ${d.late} d</span>` : ''}`;
  $('rem-hist').textContent = '';
  $('rem-hist').className = 'note';
  $('rem-to').value = '';
  $('rem-to').placeholder = 'tražim adresu u Gmailu…';
  $('rem-to-list').innerHTML = '';
  $('rem-subj').value = `Podsjetnik na dospjeli račun ${d.no}`;
  $('rem-body').value = reminderText(d);
  $('rem-pdf').href = d.pdf || '#';
  $('rem-pdf').style.display = d.pdf ? '' : 'none';
  remStatus('');
  $('rem-send').disabled = false;
  $('rem-draft').disabled = false;
  $('rem-bg').hidden = false;

  try {
    const { data } = await api(`/api/racun/${encodeURIComponent(d.no)}/kontakt`);
    if (data.addresses.length) {
      $('rem-to').value = data.addresses[0];
      $('rem-to-list').innerHTML = data.addresses.map((a) => `<option value="${esc(a)}">`).join('');
      $('rem-to').placeholder = '';
    } else {
      $('rem-to').placeholder = 'adresa nije nađena — upiši ručno';
    }
    if (data.soloReminders.length) {
      // hr-HR datum već završava točkom — ne dodaj drugu
      const datumi = data.soloReminders.map((t) => new Date(t).toLocaleDateString('hr-HR').replace(/\.$/, '')).join(', ');
      $('rem-hist').textContent = `Solo je za ovaj račun već slao obavijest o dugovanju: ${datumi}.`;
    } else if (!data.found) {
      $('rem-hist').textContent = 'U Gmailu nema traga Solo maila za ovaj račun — provjeri adresu.';
    }
  } catch {
    $('rem-to').placeholder = 'adresa nije nađena — upiši ručno';
  }
}

async function sendReminder(asDraft) {
  if (!remCur) return;
  const to = $('rem-to').value.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    remStatus('Upiši ispravnu e-mail adresu klijenta.', 'err');
    $('rem-to').focus();
    return;
  }
  $('rem-send').disabled = true;
  $('rem-draft').disabled = true;
  remStatus(asDraft ? 'Spremam skicu…' : 'Šaljem…');

  try {
    await api('/api/opomena', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject: $('rem-subj').value.trim(), body: $('rem-body').value, draft: asDraft }),
    });
    if (asDraft) {
      remStatus('Skica je spremljena u Gmail (mapa Skice).', 'ok');
      $('rem-send').disabled = false;
      $('rem-draft').disabled = false;
      return;
    }
    const stamp = fmtTime(Date.now());
    sentReminders.set(remCur.no, stamp);
    remStatus(`Opomena poslana na ${to}.`, 'ok');
    const btn = document.querySelector(`button.act[data-rem="${CSS.escape(remCur.no)}"]`);
    if (btn) btn.outerHTML = `<span class="chip good">opomena poslana ${esc(stamp)}</span>`;
    setTimeout(() => { $('rem-bg').hidden = true; }, 1200);
  } catch (e) {
    remStatus('Nije uspjelo: ' + e.message, 'err');
    $('rem-send').disabled = false;
    $('rem-draft').disabled = false;
  }
}

$('tbl-due').addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const b = e.target.closest('button.act[data-rem]') || e.target.closest('tr.due-row[data-rem]');
  if (!b) return;
  const d = snap.due.find((x) => x.no === b.dataset.rem);
  if (d && d.amount > 0) openReminder(d.no);
});
$('rem-close').addEventListener('click', () => { $('rem-bg').hidden = true; });
$('rem-bg').addEventListener('click', (e) => { if (e.target === e.currentTarget) $('rem-bg').hidden = true; });
$('rem-send').addEventListener('click', () => sendReminder(false));
$('rem-draft').addEventListener('click', () => sendReminder(true));

// ---------- chat ----------
const chatTurns = [];
let chatCtl = null;
const chatlog = $('chatlog');

function addMsg(cls, text) {
  const el = document.createElement('div');
  el.className = 'm ' + cls;
  el.textContent = text;
  chatlog.appendChild(el);
  chatlog.scrollTop = chatlog.scrollHeight;
  return el;
}

async function askClaude(q) {
  const send = $('chat-send');
  const input = $('chat-in');
  addMsg('u', q);
  chatTurns.push({ role: 'user', content: q });
  while (chatTurns.length > 12) chatTurns.shift();

  const bubble = addMsg('a think', 'Razmišljam…');
  chatCtl = new AbortController();
  send.textContent = 'Stop';
  send.classList.add('stop');
  send.type = 'button';
  input.disabled = true;
  const stop = () => chatCtl.abort();
  send.addEventListener('click', stop);

  let text = '';
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: chatTurns }),
      signal: chatCtl.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error?.message || `Greška ${res.status}.`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === 'text') {
          text += ev.text;
          bubble.classList.remove('think');
          bubble.textContent = text;
        } else if (ev.type === 'tool') {
          bubble.classList.add('think');
          bubble.textContent = text + (text ? '\n' : '') + 'Dodajem termin u kalendar…';
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
        chatlog.scrollTop = chatlog.scrollHeight;
      }
    }
    bubble.classList.remove('think');
    bubble.textContent = text || 'Nije stigao odgovor. Pokušaj ponovno.';
    if (text) chatTurns.push({ role: 'assistant', content: text });
    else chatTurns.pop();
    loadAll({ refresh: false });
  } catch (e) {
    bubble.classList.remove('think');
    if (e.name === 'AbortError') {
      bubble.textContent = (text || '') + ' (prekinuto)';
    } else {
      bubble.textContent = (text ? text + '\n' : '') + e.message;
    }
    chatTurns.pop();
  } finally {
    send.removeEventListener('click', stop);
    send.textContent = 'Pošalji';
    send.classList.remove('stop');
    send.type = 'submit';
    input.disabled = false;
    input.focus();
  }
}

$('chatform').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('chat-in').value.trim();
  if (!q || $('chat-in').disabled) return;
  $('chat-in').value = '';
  askClaude(q);
});
$('btn-chat').addEventListener('click', () => {
  const b = $('chatbox');
  b.hidden = !b.hidden;
  if (!b.hidden) $('chat-in').focus();
});
$('chat-close').addEventListener('click', () => { $('chatbox').hidden = true; });

// ---------- prijava i pokretanje ----------
const LOGIN_ERRORS = {
  odbijena: 'Prijava je prekinuta — pristup nije odobren.',
  neispravna: 'Prijava nije uspjela (neispravan zahtjev). Pokušaj ponovno.',
  zabranjena: 'Taj Google račun nema pristup ovom pultu.',
  greska: 'Prijava nije uspjela. Pokušaj ponovno.',
};

function showLogin(message) {
  $('app').hidden = true;
  $('login').hidden = false;
  const err = $('login-err');
  if (message) { err.textContent = message; err.hidden = false; } else { err.hidden = true; }
}

$('btn-refresh').addEventListener('click', () => loadAll({ refresh: true }));
$('btn-logout').addEventListener('click', async () => {
  await fetch('/auth/odjava', { method: 'POST', credentials: 'same-origin' });
  location.href = '/';
});

async function boot() {
  $('today').textContent = new Date().toLocaleDateString('hr-HR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const params = new URLSearchParams(location.search);
  const loginError = params.get('prijava');
  if (loginError) history.replaceState(null, '', location.pathname);

  let me;
  try {
    me = await (await fetch('/auth/ja', { credentials: 'same-origin' })).json();
  } catch {
    return showLogin('Poslužitelj nije dostupan.');
  }
  if (!me.prijavljen) return showLogin(loginError ? LOGIN_ERRORS[loginError] || LOGIN_ERRORS.greska : '');

  $('login').hidden = true;
  $('app').hidden = false;
  chatEnabled = Boolean(me.chat);
  sender = me.potpis || {};
  $('btn-chat').hidden = !chatEnabled;
  $('user-box').hidden = false;
  $('user-email').textContent = me.korisnik?.email || '';
  if (me.sheetUrl) $('sheet-link').href = me.sheetUrl;
  if (me.sheetNaziv) $('sheet-link').textContent = me.sheetNaziv;

  await loadAll();
  setInterval(() => loadAll({ refresh: true }), REFRESH_MS);
}

boot();
