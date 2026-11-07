import { app, api, html, toast, modal, moveTicket, fitBadge, stageLabel, when, exportUrl, $, $$ } from '../app.js';

let mainEl = null;
let tickets = [];
let filter = { q: '', target: '', showClosed: false };

// Order of the cards inside each column. Remembered in this browser only.
const SORTS = [
  ['found_desc', 'Newest found first'],
  ['found_asc', 'Oldest found first'],
  ['applied_desc', 'Applied most recently'],
  ['applied_asc', 'Applied longest ago'],
  ['changed_desc', 'Last changed'],
  ['posted_desc', 'Newest ad first'],
  ['deadline_asc', 'Apply-by date, soonest'],
  ['fit_desc', 'Best fit first'],
  ['company_asc', 'Company A–Z'],
  ['company_desc', 'Company Z–A'],
  ['title_asc', 'Job title A–Z'],
  ['key_asc', 'Ticket number'],
];
let sortBy = 'found_desc';
try { sortBy = localStorage.getItem('hb.board.sort') || sortBy; } catch { /* storage blocked */ }
if (!SORTS.some(([id]) => id === sortBy)) sortBy = 'found_desc';

const time = (v) => { const n = Date.parse(v || ''); return Number.isNaN(n) ? null : n; };
const lastChange = (t) => time(t.status_changed_at) ?? time((t.history || []).slice(-1)[0]?.at) ?? time(t.created_at);
const keyN = (t) => Number(String(t.key).replace(/\D/g, '')) || 0;
const KEYS = {
  found: (t) => time(t.found_at || t.created_at),
  applied: (t) => time(t.applied_at),
  changed: lastChange,
  posted: (t) => time(t.posted),
  deadline: (t) => time(t.deadline),
  fit: (t) => (t.fit && typeof t.fit.score === 'number' ? t.fit.score : null),
  company: (t) => (t.company || '').trim().toLowerCase() || null,
  title: (t) => (t.title || '').trim().toLowerCase() || null,
  key: keyN,
};

// Cards without the value (never applied, no apply-by date, no fit) go last whichever way the list runs.
function sorted(list) {
  const [field, dir] = sortBy.split('_');
  const get = KEYS[field];
  const sign = dir === 'desc' ? -1 : 1;
  return list.map((t) => [t, get(t)]).sort(([a, x], [b, y]) => {
    if (x == null && y == null) return keyN(b) - keyN(a);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === 'string' ? x.localeCompare(y, 'de') : x - y;
    return c ? sign * c : keyN(b) - keyN(a);
  }).map(([t]) => t);
}

export async function render(main) {
  mainEl = main;
  tickets = await api('GET', '/api/tickets');
  const targets = app.state.profile.targets;
  main.innerHTML = html`<div class="page wide">
    <div class="page-head"><div class="grow"><h1>Board</h1><p class="muted">Drag a card to change its status. Click it to open the ticket.</p></div>
      <input type="search" id="q" placeholder="Search jobs…" value="${filter.q}" style="width:220px">
      <button class="btn" id="add">+ Add a job</button>
      <a class="btn ghost" href="${exportUrl()}" title="Download all tickets as a spreadsheet">Export</a></div>
    <div class="row" style="margin-bottom:12px">
      <button class="chip ${!filter.target ? 'on' : ''}" data-target="">All searches</button>
      ${targets.map((t) => html`<button class="chip ${filter.target === t.id ? 'on' : ''}" data-target="${t.id}">${t.name}</button>`)}
      <span class="spacer"></span>
      <label class="small muted" for="sort">Sort</label>
      <select id="sort" class="small" title="Order of the cards in each column">${SORTS.map(([id, label]) => html`<option value="${id}" ${sortBy === id ? 'selected' : ''}>${label}</option>`)}</select>
      <label class="check small"><input type="checkbox" id="closed" ${filter.showClosed ? 'checked' : ''}> Show closed</label>
    </div>
    <div class="board" id="board"></div></div>`.s;
  drawBoard();
  // Back from a ticket: each column scrolled where it was.
  for (const [id, y] of Object.entries(colScroll)) { const b = $(`.col[data-status="${id}"] .col-body`, main); if (b) b.scrollTop = y; }
  $('#q', main).addEventListener('input', (e) => { filter.q = e.target.value; drawBoard(); });
  $('#sort', main).addEventListener('change', (e) => {
    sortBy = e.target.value;
    try { localStorage.setItem('hb.board.sort', sortBy); } catch { /* storage blocked */ }
    drawBoard();
  });
  $('#closed', main).addEventListener('change', (e) => { filter.showClosed = e.target.checked; drawBoard(); });
  $$('[data-target]', main).forEach((b) => b.addEventListener('click', () => { filter.target = b.dataset.target; render(main); }));
  $('#add', main).addEventListener('click', addJob);
}

const colScroll = {};
export function leave() {
  if (!mainEl) return;
  for (const c of $$('.col', mainEl)) colScroll[c.dataset.status] = $('.col-body', c).scrollTop;
}

function visible() {
  const q = filter.q.trim().toLowerCase();
  return sorted(tickets.filter((t) => (!filter.target || t.target === filter.target)
    && (!q || `${t.key} ${t.title} ${t.company} ${t.location}`.toLowerCase().includes(q))));
}

function card(t) {
  const iv = t.status === 'interview' && t.interview.rounds.length ? t.interview.rounds[t.interview.rounds.length - 1] : null;
  return html`<a class="tcard" draggable="true" data-key="${t.key}" href="#/ticket/${t.key}">
    <div class="row" style="gap:6px"><span class="co">${t.company || '—'}</span><span class="spacer"></span>${fitBadge(t.fit)}</div>
    <div class="ti">${t.title}</div>
    ${t.needs ? html`<div class="meta"><span class="badge warn" title="${t.needs.text}">Needs you</span></div>` : ''}
    <div class="meta">${t.location ? html`<span>${t.location}${t.mode ? ` · ${t.mode}` : ''}</span>` : ''}${t.source ? html`<span>· ${t.source}</span>` : ''}</div>
    ${iv ? html`<div class="meta"><span class="badge info">${stageLabel(iv.stage)}</span>${iv.at ? html`<span>${when(iv.at)}</span>` : ''}</div>` : ''}
    ${t.status === 'closed' && t.resolution ? html`<div class="meta"><span class="badge">${t.resolution}</span></div>` : ''}
    <div class="meta"><span class="key">${t.key}</span><span class="spacer"></span><span>${t.age_days ? `${t.age_days} d` : 'new'}</span></div>
  </a>`;
}

function drawBoard() {
  const el = $('#board', mainEl);
  if (!el) return;
  const list = visible();
  const statuses = app.meta.statuses.filter((s) => s.id !== 'closed' || filter.showClosed);
  el.innerHTML = statuses.map((s) => {
    const items = list.filter((t) => t.status === s.id);
    return html`<section class="col" data-status="${s.id}" aria-label="${s.label}">
      <div class="col-head"><span class="dot" style="background:var(--st-${s.id})"></span>${s.label}<span class="count">${items.length}</span></div>
      <div class="col-body">${items.length ? items.map(card) : html`<div class="muted small" style="padding:10px;text-align:center">${s.id === 'found' ? 'New jobs from searches land here.' : 'Drop cards here'}</div>`}</div>
    </section>`.s;
  }).join('');
  bindDrag(el);
}

function bindDrag(el) {
  let dragKey = null;
  $$('.tcard', el).forEach((c) => {
    c.addEventListener('dragstart', (e) => { dragKey = c.dataset.key; c.classList.add('dragging'); e.dataTransfer.setData('text/plain', dragKey); e.dataTransfer.effectAllowed = 'move'; });
    c.addEventListener('dragend', () => c.classList.remove('dragging'));
    c.addEventListener('contextmenu', (e) => { e.preventDefault(); moveMenu(c.dataset.key); });
    c.addEventListener('keydown', (e) => { if (e.key === 'm' || e.key === 'M') { e.preventDefault(); moveMenu(c.dataset.key); } });
  });
  $$('.col', el).forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drop');
      const key = e.dataTransfer.getData('text/plain') || dragKey;
      await doMove(key, col.dataset.status);
    });
  });
}

async function doMove(key, status) {
  const t = tickets.find((x) => x.key === key);
  if (!t || (t.status === status && status !== 'interview')) return;
  try {
    const updated = await moveTicket(t, status);
    if (updated) {
      Object.assign(t, updated);
      drawBoard();
      toast(`${t.key} moved to ${app.meta.statuses.find((s) => s.id === status).label}`);
    }
  } catch (err) {
    toast(err.message, true);
  }
}

// Keyboard / right-click alternative to drag and drop.
async function moveMenu(key) {
  const t = tickets.find((x) => x.key === key);
  const status = await modal({
    title: `Move ${key}`,
    body: html`<p class="muted">${t.title}${t.company ? ` · ${t.company}` : ''}</p>`.s,
    actions: [{ label: 'Cancel', value: null }, ...app.meta.statuses.filter((s) => s.id !== t.status || s.id === 'interview').map((s) => ({ label: s.label, value: s.id }))],
  });
  if (status) doMove(key, status);
}


async function addJob() {
  const out = await modal({
    title: 'Add a job yourself',
    wide: true,
    body: html`<p class="muted">Found a job somewhere else? Add it here. The AI can then tailor your CV, write a letter and prepare you.</p>
      <div class="form-grid">
        <label class="field">Job title *<input type="text" name="title" required></label>
        <label class="field">Company<input type="text" name="company"></label>
        <label class="field">Location<input type="text" name="location"></label>
        <label class="field">Link to the ad<input type="url" name="link" placeholder="https://"></label>
      </div>
      <label class="field" style="margin-top:12px">The job ad text <span class="hint">paste it, ads often disappear</span><textarea name="posting" rows="8"></textarea></label>
      <label class="field" style="margin-top:12px">Column<select name="status"><option value="to_apply">To apply</option><option value="applied">Applied</option><option value="found">Found</option></select></label>`.s,
    actions: [{ label: 'Cancel', value: null }, {
      label: 'Add', kind: 'primary', onClick: (root) => {
        const f = (n) => root.querySelector(`[name=${n}]`).value.trim();
        if (!f('title')) { toast('Please enter the job title.', true); return false; }
        return { title: f('title'), company: f('company'), location: f('location'), link: f('link'), posting: f('posting'), status: f('status'), source: 'Added by me' };
      },
    }],
  });
  if (!out) return;
  try {
    const t = await api('POST', '/api/tickets', out);
    toast(`${t.key} added`);
    location.hash = `#/ticket/${t.key}`;
  } catch (err) {
    toast(err.message, true);
  }
}

export async function onEvent(name) {
  if (name === 'tickets' && mainEl && document.querySelector('#board')) {
    tickets = await api('GET', '/api/tickets');
    drawBoard();
  }
}
