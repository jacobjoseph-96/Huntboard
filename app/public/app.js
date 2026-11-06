// Huntboard app shell: API access, live updates, routing, dialogs and shared helpers.

import * as home from './pages/home.js';
import * as search from './pages/search.js';
import * as board from './pages/board.js';
import * as ticket from './pages/ticket.js';
import * as chat from './pages/chat.js';
import * as profile from './pages/profile.js';
import * as settings from './pages/settings.js';
import * as activity from './pages/activity.js';
import * as setup from './pages/setup.js';

const TOKEN = document.querySelector('meta[name="hb-token"]').content;
const PAGES = { home, search, board, ticket, chat, profile, settings, activity, setup };

export const app = { meta: null, state: null, tools: null, page: null, pageName: '', runs: new Map() };

// ---- HTML helpers -------------------------------------------------------------------------------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v == null ? '' : esc(v));
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += val(v) + strings[i + 1]; });
  return raw(out);
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Markdown from job ads and the AI: raw HTML is escaped, only safe links are kept.
let mdReady = false;
export function md(text) {
  const m = window.marked;
  if (!m) return html`<pre>${text}</pre>`.s;
  if (!mdReady) {
    m.use({
      gfm: true,
      breaks: true,
      renderer: {
        html(token) { return esc(typeof token === 'string' ? token : token.text || token.raw || ''); },
        link(href, title, text) {
          if (typeof href === 'object') ({ href, title, text } = { href: href.href, title: href.title, text: href.text });
          const ok = /^(https?:|mailto:)/i.test(String(href || ''));
          return ok ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${text}</a>` : text;
        },
        image(href, title, text) {
          if (typeof href === 'object') text = href.text;
          return esc(text || '');
        },
      },
    });
    mdReady = true;
  }
  return m.parse(String(text || ''));
}

// ---- formatting -----------------------------------------------------------------------------------
export function ago(iso) {
  if (!iso) return '';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}
export const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');
export const statusLabel = (s) => (app.meta.statuses.find((x) => x.id === s) || { label: s }).label;
export const stageLabel = (s) => (app.meta.stages.find((x) => x.id === s) || { label: s || 'Interview' }).label;
export const fitClass = (n) => (n == null ? '' : n >= 70 ? 'hi' : n >= 45 ? 'mid' : 'lo');
export const fitBadge = (fit) => (fit && fit.score != null ? html`<span class="fit ${fitClass(fit.score)}" title="Fit score">${fit.score}%</span>` : '');
export const safeUrl = (u) => (/^(https?:|mailto:)/i.test(String(u || '').trim()) ? String(u).trim() : '#');
export const hasSkill = (s) => app.meta.skills.includes(s);

// ---- API ---------------------------------------------------------------------------------------------
export async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: { 'x-huntboard-token': TOKEN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
export const fileUrl = (key, rel, download) => `/api/tickets/${encodeURIComponent(key)}/file?path=${encodeURIComponent(rel)}${download ? '&download=1' : ''}&token=${encodeURIComponent(TOKEN)}`;
export const docUrl = (id) => `/api/documents/${encodeURIComponent(id)}/file?token=${encodeURIComponent(TOKEN)}`;
export const exportUrl = () => `/api/export.xlsx?token=${encodeURIComponent(TOKEN)}`;

export async function refreshState() {
  app.state = await api('GET', '/api/state');
  renderChrome();
  return app.state;
}

// ---- toasts & dialogs ------------------------------------------------------------------------------
export function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = `toast${bad ? ' bad' : ''}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), bad ? 6000 : 3200);
}

export function modal({ title, body, actions = [], onOpen, dismissable = true, wide = false }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = html`<div class="modal" role="dialog" aria-modal="true" aria-label="${title}" style="${wide ? 'width:min(760px,100%)' : ''}">
      <h2>${title}</h2><div class="modal-body">${raw(body)}</div>
      <div class="actions">${actions.map((a, i) => html`<button class="btn ${a.kind || ''}" data-i="${i}" type="button">${a.label}</button>`)}</div>
    </div>`.s;
    const close = (v) => { back.remove(); resolve(v); };
    back.addEventListener('click', async (e) => {
      if (e.target === back && dismissable) return close(null);
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const a = actions[Number(b.dataset.i)];
      const out = a.onClick ? await a.onClick(back) : a.value;
      if (out !== false) close(out === undefined ? a.value : out);
    });
    back.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dismissable) close(null); });
    $('#modal-root').append(back);
    const first = back.querySelector('input, textarea, select, .btn.primary');
    if (first) first.focus();
    if (onOpen) onOpen(back);
  });
}

export const confirmDialog = (title, text, okLabel = 'OK') =>
  modal({ title, body: html`<p>${text}</p>`.s, actions: [{ label: 'Cancel', value: false }, { label: okLabel, kind: 'primary', value: true }] });

export function interviewDialog(t, { title = 'Interview invitation' } = {}) {
  const stages = app.meta.stages;
  const next = t && t.interview && t.interview.rounds && t.interview.rounds.length ? 'panel' : 'hr_screen';
  const body = html`
    <p class="muted">Tell Huntboard about the interview so the AI can prepare you for exactly this step.</p>
    <div class="form-grid">
      <label class="field">Which step is it?
        <select name="stage">${stages.map((s) => html`<option value="${s.id}" ${s.id === next ? 'selected' : ''}>${s.label}</option>`)}</select></label>
      <label class="field">Date and time <span class="hint">if you know it</span><input type="datetime-local" name="at"></label>
      <label class="field">Format<select name="format"><option>Video call</option><option>Phone</option><option>On site</option><option>Recorded video</option><option>Other</option></select></label>
      <label class="field">Language<input type="text" name="language" placeholder="e.g. English"></label>
    </div>
    <label class="field" style="margin-top:12px">Who will be there? <span class="hint">names and roles, separated by commas</span><input type="text" name="interviewers"></label>
    <label class="field" style="margin-top:12px">Invitation e-mail <span class="hint">paste it here; it helps the AI a lot</span><textarea name="invitation" rows="5"></textarea></label>`.s;
  return modal({
    title,
    body,
    actions: [
      { label: 'Cancel', value: null },
      {
        label: 'Save',
        kind: 'primary',
        onClick: (root) => {
          const f = (n) => root.querySelector(`[name=${n}]`).value.trim();
          const at = f('at');
          return { stage: f('stage'), at: at ? new Date(at).toISOString() : '', format: f('format'), language: f('language'), interviewers: f('interviewers'), invitation: f('invitation') };
        },
      },
    ],
  });
}

export function closeDialog() {
  const opts = [['rejected', 'They said no'], ['dismissed', 'Not interested'], ['withdrawn', 'I withdrew'], ['declined', 'I declined an offer'], ['accepted', 'I accepted the job 🎉'], ['expired', 'The ad is gone']];
  return modal({
    title: 'Close this job',
    body: html`<div class="choice-cards">${opts.map(([v, l], i) => html`<label class="choice-card"><input type="radio" name="res" value="${v}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`)}</div>
      <label class="field" style="margin-top:12px">Note <span class="hint">optional</span><input type="text" name="note"></label>`.s,
    actions: [{ label: 'Cancel', value: null }, { label: 'Close job', kind: 'primary', onClick: (root) => ({ resolution: root.querySelector('[name=res]:checked').value, note: root.querySelector('[name=note]').value }) }],
  });
}

// Move a ticket, asking for interview details / close reason when needed.
export async function moveTicket(t, status) {
  if (status === t.status && status !== 'interview') return null;
  if (status === 'interview') {
    const iv = await interviewDialog(t);
    if (!iv) return null;
    const out = await api('POST', `/api/tickets/${t.key}/move`, { status, interview: iv });
    if (hasSkill('interview-prep') && !(app.state.settings.ai.auto_prepare_interviews)) {
      const go = await confirmDialog('Prepare now?', `The AI can prepare you for the ${stageLabel(iv.stage)} at ${t.company || 'this company'} now.`, 'Prepare now');
      if (go) startRun('interview-prep', { ticket: t.key });
    }
    return out;
  }
  if (status === 'closed') {
    const c = await closeDialog();
    if (!c) return null;
    return api('POST', `/api/tickets/${t.key}/move`, { status, ...c });
  }
  return api('POST', `/api/tickets/${t.key}/move`, { status });
}

// ---- AI runs -------------------------------------------------------------------------------------------
export async function startRun(skill, opts = {}) {
  if (!app.state.settings.ai.tool) {
    toast('Choose your AI tool in Settings first.', true);
    location.hash = '#/settings?tab=ai';
    return null;
  }
  try {
    const run = await api('POST', '/api/runs', { skill, ...opts });
    app.runs.set(run.id, run);
    renderRunbar();
    toast('The AI started working. You can keep using the app.');
    return run;
  } catch (err) {
    toast(err.message, true);
    return null;
  }
}

function renderRunbar() {
  const bar = $('#runbar');
  const runs = [...app.runs.values()].filter((r) => r.status === 'running' || r.status === 'queued' || (r.finished_at && Date.now() - Date.parse(r.finished_at) < 20000 && !r._dismissed));
  const r = runs.sort((a, b) => (a.status === 'running' ? -1 : 1) - (b.status === 'running' ? -1 : 1))[0];
  if (!r || app.pageName === 'activity') { bar.hidden = true; return; }
  bar.hidden = false;
  const live = r.status === 'running' || r.status === 'queued';
  bar.innerHTML = html`<div class="row">
      ${live ? html`<span class="spinner"></span>` : html`<span class="badge ${r.status === 'done' ? 'ok' : 'bad'}">${r.status === 'done' ? 'Done' : r.status}</span>`}
      <span class="title">${r.title}</span><span class="spacer"></span>
      <a class="btn small ghost" href="#/activity?run=${r.id}">Details</a>
      ${live ? html`<button class="btn small" data-cancel="${r.id}">Stop</button>` : html`<button class="btn small ghost" data-dismiss="${r.id}" aria-label="Close">✕</button>`}
    </div>
    ${live ? html`<ul class="steps">${(r.steps || []).slice(-3).map((s) => html`<li>${s.text}</li>`)}${r.status === 'queued' ? html`<li>Waiting for the previous task to finish…</li>` : ''}</ul>` : ''}
    ${!live && r.error ? html`<div class="small" style="margin-top:6px;color:var(--danger)">${r.error}</div>` : ''}
    ${!live && r.result_text ? html`<div class="small md" style="margin-top:6px;max-height:140px;overflow:auto">${raw(md(r.result_text))}</div>` : ''}`.s;
}
document.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-cancel]');
  if (c) {
    await api('POST', `/api/runs/${c.dataset.cancel}/cancel`).catch((err) => toast(err.message, true));
    return;
  }
  const d = e.target.closest('[data-dismiss]');
  if (d) {
    const r = app.runs.get(d.dataset.dismiss);
    if (r) r._dismissed = true;
    renderRunbar();
  }
});

// ---- questions from the AI -------------------------------------------------------------------------
const shownAsks = new Set();
async function checkAsks() {
  const list = await api('GET', '/api/asks').catch(() => []);
  // A question answered elsewhere, or decided by the AI in fully automatic mode: close its dialog.
  const pendingIds = new Set(list.map((a) => a.id));
  $$('.modal-back[data-ask]').forEach((el) => { if (!pendingIds.has(el.dataset.ask)) el.remove(); });
  for (const a of list) {
    if (shownAsks.has(a.id)) continue;
    shownAsks.add(a.id);
    notify('Huntboard needs you', a.question);
    showAsk(a);
  }
}
async function showAsk(a) {
  const choices = a.choices && a.choices.length ? a.choices : null;
  const wait = a.proxy ? (app.state.profile.applying.proxy_wait_seconds || 0) : 0;
  const left = a.proxy ? Math.max(0, Math.round(wait - (Date.now() - Date.parse(a.created_at)) / 1000)) : 0;
  const body = html`${a.proxy ? html`<div class="notice warn small" style="margin-bottom:10px">Fully automatic mode: if you don't answer within <b data-countdown="${left}">${left}</b> s, the AI decides for you and writes down what it chose.</div>` : ''}
    <p style="white-space:pre-wrap">${a.question}</p>${a.details ? html`<div class="md small muted">${raw(md(a.details))}</div>` : ''}
    ${a.ticket ? html`<p class="small muted">About ticket <a href="#/ticket/${a.ticket}">${a.ticket}</a></p>` : ''}
    ${choices ? '' : html`<label class="field">Your answer<textarea name="answer" rows="3"></textarea></label>`}`.s;
  const actions = choices
    ? choices.map((c, i) => ({ label: c, kind: i === 0 ? 'primary' : '', value: c }))
    : [{ label: 'Send answer', kind: 'primary', onClick: (root) => root.querySelector('[name=answer]').value.trim() || false }];
  const answer = await modal({
    title: 'The AI asks you',
    body,
    actions,
    dismissable: false,
    onOpen: (back) => {
      back.dataset.ask = a.id;
      const cd = back.querySelector('[data-countdown]');
      if (cd) {
        let n = Number(cd.dataset.countdown);
        const t = setInterval(() => { n = Math.max(0, n - 1); cd.textContent = n; if (!back.isConnected) clearInterval(t); }, 1000);
      }
    },
  });
  if (answer != null) {
    await api('POST', `/api/asks/${a.id}/answer`, { answer }).catch((err) => toast(err.message, true));
    toast('Answer sent to the AI.');
  }
}
function notify(title, body) {
  try {
    if (document.hasFocus()) return;
    if (Notification.permission === 'granted') new Notification(title, { body, icon: '/assets/logo/huntboard-badge.svg' });
    else if (Notification.permission === 'default') Notification.requestPermission();
  } catch { /* notifications not available */ }
}

// ---- chrome (sidebar etc.) --------------------------------------------------------------------------
function renderChrome() {
  const s = app.state;
  const tool = app.tools && app.tools.tools.find((t) => t.id === s.settings.ai.tool);
  $('#ai-chip').innerHTML = tool ? html`AI: <b>${tool.name.split(' (')[0]}</b>`.s : html`<a href="#/settings?tab=ai">Choose your AI tool</a>`.s;
  api('GET', '/api/inbox').then((items) => {
    const n = items.filter((i) => i.type !== 'review_found' && i.type !== 'apply_ready').length;
    const pill = $('#nav-inbox');
    pill.hidden = !n;
    pill.textContent = n;
  }).catch(() => {});
}

// ---- router ------------------------------------------------------------------------------------------------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, '') || 'home';
  const [pathPart, query = ''] = h.split('?');
  const [name, ...rest] = pathPart.split('/');
  return { name, args: rest.map(decodeURIComponent), query: Object.fromEntries(new URLSearchParams(query)) };
}

async function route() {
  const { name, args, query } = parseHash();
  const page = PAGES[name] || home;
  if (app.page && app.page.leave) app.page.leave();
  app.page = page;
  app.pageName = PAGES[name] ? name : 'home';
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === app.pageName || (app.pageName === 'ticket' && a.dataset.nav === 'board')));
  const main = $('#main');
  main.innerHTML = '<div class="page"><div class="empty"><span class="spinner"></span></div></div>';
  try {
    await page.render(main, { args, query });
  } catch (err) {
    main.innerHTML = html`<div class="page"><div class="notice bad">${err.message}</div></div>`.s;
  }
  main.focus({ preventScroll: true });
  renderRunbar();
}

// ---- live updates -------------------------------------------------------------------------------------------
function connect() {
  const es = new EventSource(`/api/events?token=${encodeURIComponent(TOKEN)}`);
  const pass = (name, data) => app.page && app.page.onEvent && app.page.onEvent(name, data);
  for (const ev of ['tickets', 'profile', 'asks', 'run']) {
    es.addEventListener(ev, async (e) => {
      const data = JSON.parse(e.data || '{}');
      if (ev === 'run') {
        app.runs.set(data.id, { ...(app.runs.get(data.id) || {}), ...data });
        renderRunbar();
        if (data.status === 'done' && data.kind === 'skill') refreshState().catch(() => {});
      }
      if (ev === 'asks') checkAsks();
      if (ev === 'profile' || ev === 'tickets') refreshState().catch(() => {});
      pass(ev, data);
    });
  }
  es.onerror = () => {
    es.close();
    setTimeout(connect, 3000);
  };
}

async function boot() {
  [app.meta, app.tools] = await Promise.all([api('GET', '/api/meta'), api('GET', '/api/ai/tools')]);
  await refreshState();
  for (const r of await api('GET', '/api/runs')) app.runs.set(r.id, r);
  if (!app.state.settings.onboarding_done && !location.hash.startsWith('#/setup')) location.hash = '#/setup';
  window.addEventListener('hashchange', route);
  await route();
  connect();
  checkAsks();
}

boot().catch((err) => {
  $('#main').innerHTML = html`<div class="page"><div class="notice bad">Huntboard could not start: ${err.message}</div></div>`.s;
});
