import { app, api, html, raw, md, toast, modal, moveTicket, interviewDialog, startRun, hasSkill, fitBadge, fitClass, statusLabel, stageLabel, when, ago, fileUrl, safeUrl, $, $$ } from '../app.js';

let mainEl = null;
let key = null;
let tab = 'posting';
let data = null;

const ACTIONS = [
  ['tailor', 'Tailor my CV'],
  ['cover-letter', 'Write a cover letter'],
  ['apply', 'Apply'],
  ['interview-prep', 'Prepare for the interview'],
  ['interview-debrief', 'Debrief the interview'],
];

const EDITABLE = [
  ['company', 'Company'], ['location', 'Location'], ['mode', 'On site / hybrid / remote'], ['job_type', 'Job type'],
  ['salary', 'Salary'], ['link', 'Link'], ['source', 'Found on'], ['posted', 'Posted'], ['deadline', 'Apply by'], ['contact', 'Contact person'],
];

export async function render(main, { args, query }) {
  mainEl = main;
  key = args[0];
  if (query.tab) tab = query.tab;
  data = await api('GET', `/api/tickets/${encodeURIComponent(key)}`);
  draw();
}

function draw() {
  const t = data.ticket;
  const statuses = app.meta.statuses;
  mainEl.innerHTML = html`<div class="page">
    <div class="small muted"><a href="#/board">Board</a> / ${t.key}</div>
    <div class="page-head" style="margin-top:6px"><div class="grow">
      <h1>${t.title}</h1>
      <div class="row muted"><b style="color:var(--ink-2)">${t.company || '—'}</b>${t.location ? html`<span>· ${t.location}</span>` : ''}${fitBadge(t.fit)}
        <span class="badge"><span class="st-dot" style="background:var(--st-${t.status})"></span>${statusLabel(t.status)}${t.resolution ? ` · ${t.resolution}` : ''}</span></div>
    </div>
      <label class="field" style="min-width:170px">Move to
        <select id="move">${statuses.map((s) => html`<option value="${s.id}" ${s.id === t.status ? 'selected' : ''}>${s.label}</option>`)}</select></label>
      ${t.link ? html`<a class="btn" href="${safeUrl(t.link)}" target="_blank" rel="noopener noreferrer">Open the ad ↗</a>` : ''}
    </div>

    ${t.needs ? html`<div class="notice warn row" style="margin-bottom:12px"><span><b>Needs you:</b> ${t.needs.text}</span><span class="spacer"></span><button class="btn small" id="needs-done">I did it</button></div>` : ''}
    <div class="row" style="margin-bottom:16px">
      ${ACTIONS.map(([skill, label]) => html`<button class="btn ${skill === suggested(t) ? 'primary' : ''}" data-skill="${skill}" ${hasSkill(skill) ? '' : raw('disabled title="Coming in a later version"')}>${label}</button>`)}
    </div>

    <div class="ticket-layout">
      <div class="card">
        <div class="tabs" role="tablist">
          ${[['posting', 'Job ad'], ['fit', 'Fit'], ['docs', 'Documents'], ['interview', 'Interview'], ['activity', 'Activity']].map(([id, label]) => html`<button role="tab" data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}${id === 'interview' && t.interview.rounds.length ? ` (${t.interview.rounds.length})` : ''}${id === 'activity' ? ` (${t.history.filter((h) => h.type === 'comment').length})` : ''}</button>`)}
        </div>
        <div id="tab">${raw(tabBody(t))}</div>
      </div>
      <aside class="card"><h3>Details</h3>
        <dl class="fields">
          ${EDITABLE.map(([k, label]) => html`<dt>${label}</dt><dd><span data-edit="${k}" tabindex="0" title="Click to edit" style="cursor:text">${k === 'link' && t[k] ? html`<a href="${safeUrl(t[k])}" target="_blank" rel="noopener noreferrer">${t[k].replace(/^https?:\/\//, '').slice(0, 40)}…</a>` : t[k] || html`<span class="muted">—</span>`}</span></dd>`)}
          <dt>Search</dt><dd>${(app.state.profile.targets.find((x) => x.id === t.target) || {}).name || html`<span class="muted">—</span>`}</dd>
          <dt>Created</dt><dd>${when(t.created_at)}</dd>
          ${t.applied_at ? html`<dt>Applied</dt><dd>${when(t.applied_at)}</dd>` : ''}
          <dt>Folder</dt><dd class="mono">${t.folder}</dd>
        </dl>
      </aside>
    </div></div>`.s;

  $('#move', mainEl).addEventListener('change', async (e) => {
    try {
      const out = await moveTicket(t, e.target.value);
      if (out) { toast(`Moved to ${statusLabel(out.status)}`); await reload(); } else e.target.value = t.status;
    } catch (err) { toast(err.message, true); e.target.value = t.status; }
  });
  const nd = $('#needs-done', mainEl);
  if (nd) nd.addEventListener('click', async () => { await api('PUT', `/api/tickets/${t.key}/needs`, { text: null }).catch((err) => toast(err.message, true)); await reload(); });
  $('[data-skill]', mainEl).forEach((b) => b.addEventListener('click', () => startRun(b.dataset.skill, { ticket: t.key })));
  $$('[data-tab]', mainEl).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  $$('[data-edit]', mainEl).forEach((el) => {
    const go = () => editField(el.dataset.edit);
    el.addEventListener('click', (e) => { if (!e.target.closest('a')) go(); });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  });
  bindTab(t);
}

function suggested(t) {
  if (t.status === 'to_apply') return 'apply';
  if (t.status === 'interview') return 'interview-prep';
  if (t.status === 'found') return 'tailor';
  return '';
}

function tabBody(t) {
  if (tab === 'posting') {
    return html`${data.posting ? html`<div class="md">${raw(md(data.posting))}</div>` : html`<div class="empty">No job ad text saved yet.</div>`}
      <div class="row end" style="margin-top:12px"><button class="btn small" id="edit-posting">${data.posting ? 'Edit the ad text' : 'Paste the ad text'}</button></div>`.s;
  }
  if (tab === 'fit') {
    const f = t.fit;
    if (!f) return html`<div class="empty">No fit check yet. The AI scores jobs it finds.</div>`.s;
    return html`<div class="row"><span class="fit ${fitClass(f.score)}" style="font-size:20px;padding:6px 10px">${f.score ?? '—'}%</span><b>${f.verdict}</b></div>
      ${f.reasons.length ? html`<h3 style="margin-top:14px">Why it fits</h3><ul>${f.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
      ${f.red_flags.length ? html`<h3>Watch out</h3><ul>${f.red_flags.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
      ${f.scored_with ? html`<p class="small muted">Scored by ${f.scored_with}</p>` : ''}`.s;
  }
  if (tab === 'docs') {
    const files = data.files.filter((f) => f.path.startsWith('docs/'));
    return html`${files.length ? html`<ul class="files">${files.map((f) => html`<li><span>📄</span><a href="${fileUrl(t.key, f.path)}" target="_blank" rel="noopener">${f.path.slice(5)}</a><span class="spacer"></span><span class="small muted">${ago(f.modified)}</span><a class="btn small ghost" href="${fileUrl(t.key, f.path, true)}">Download</a></li>`)}</ul>`
      : html`<div class="empty">No documents for this job yet. Use "Tailor my CV" or "Write a cover letter".</div>`}`.s;
  }
  if (tab === 'interview') {
    const rounds = t.interview.rounds || [];
    return html`${rounds.length ? rounds.slice().reverse().map((r) => {
      const prep = data.files.filter((f) => r.prep_dir && f.path.startsWith(r.prep_dir.replace(/\/$/, '') + '/'));
      return html`<div class="round"><div class="row"><b>Round ${r.n}: ${stageLabel(r.stage)}</b><span class="spacer"></span>${r.at ? html`<span class="badge info">${when(r.at)}</span>` : html`<span class="badge">date not set</span>`}</div>
        <div class="small muted">${[r.format, r.language, r.interviewers.join(', ')].filter(Boolean).join(' · ')}</div>
        ${r.invitation ? html`<details style="margin-top:6px"><summary class="small">Invitation</summary><div class="small" style="white-space:pre-wrap">${r.invitation}</div></details>` : ''}
        ${prep.length ? html`<h3 style="margin-top:10px">Preparation</h3><ul class="files">${prep.map((f) => html`<li><a href="#" data-open="${f.path}">${f.path.split('/').pop()}</a><span class="spacer"></span><a class="small" href="${fileUrl(t.key, f.path)}" target="_blank" rel="noopener">raw</a></li>`)}</ul>`
          : html`<p class="small muted" style="margin-top:6px">No preparation yet.</p>`}
        ${r.debrief ? html`<details><summary class="small">Debrief</summary><div class="md small">${raw(md(r.debrief))}</div></details>` : ''}
      </div>`;
    }) : html`<div class="empty">No interview yet. When you get an invitation, add it here.</div>`}
      <div class="row end"><button class="btn" id="add-round">+ Add an interview round</button></div>
      <div id="viewer" class="md" style="margin-top:12px"></div>`.s;
  }
  // activity
  return html`<ul class="history">${t.history.slice().reverse().map((h) => html`<li><span class="when">${ago(h.at)}<br><span class="small">${h.by === 'agent' ? 'AI' : 'You'}</span></span>
      <span>${h.type === 'comment' ? html`<div class="comment">${h.text}</div>` : h.type === 'status' ? html`Moved to <b>${statusLabel(h.to)}</b>${h.from ? ` from ${statusLabel(h.from)}` : ''}${h.resolution ? ` (${h.resolution})` : ''}${h.text ? html`<div class="small muted">${h.text}</div>` : ''}` : html`${h.type === 'created' ? 'Created' : ''} ${h.text || ''}`}</span></li>`)}</ul>
    <label class="field" style="margin-top:14px">Add a note <span class="hint">facts or wishes for this job, e.g. "I know the manager", "Mention my weekend availability". The AI reads them.</span>
      <textarea id="note" rows="3"></textarea></label>
    <div class="row end" style="margin-top:8px"><button class="btn primary" id="add-note">Add note</button></div>`.s;
}

function bindTab(t) {
  const ep = $('#edit-posting', mainEl);
  if (ep) ep.addEventListener('click', async () => {
    const text = await modal({ title: 'Job ad text', wide: true, body: html`<textarea name="p" rows="16" style="width:100%">${data.posting}</textarea>`.s, actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', onClick: (r) => r.querySelector('[name=p]').value }] });
    if (text == null) return;
    await api('PUT', `/api/tickets/${t.key}/posting`, { text }).catch((err) => toast(err.message, true));
    await reload();
  });
  const an = $('#add-note', mainEl);
  if (an) an.addEventListener('click', async () => {
    const text = $('#note', mainEl).value.trim();
    if (!text) return;
    await api('POST', `/api/tickets/${t.key}/notes`, { text }).catch((err) => toast(err.message, true));
    await reload();
  });
  const ar = $('#add-round', mainEl);
  if (ar) ar.addEventListener('click', async () => {
    const iv = await interviewDialog(t, { title: 'New interview round' });
    if (!iv) return;
    await api('POST', `/api/tickets/${t.key}/rounds`, iv).catch((err) => toast(err.message, true));
    await reload();
    if (hasSkill('interview-prep')) startRun('interview-prep', { ticket: t.key });
  });
  $$('[data-open]', mainEl).forEach((a) => a.addEventListener('click', async (e) => {
    e.preventDefault();
    const res = await fetch(fileUrl(t.key, a.dataset.open));
    const text = await res.text();
    const v = $('#viewer', mainEl);
    v.innerHTML = a.dataset.open.endsWith('.md') ? md(text) : html`<pre>${text}</pre>`.s;
    v.scrollIntoView({ behavior: 'smooth' });
  }));
}

async function editField(field) {
  const t = data.ticket;
  const label = EDITABLE.find(([k]) => k === field)[1];
  const value = await modal({ title: label, body: html`<input type="text" name="v" value="${t[field] || ''}">`.s, actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', onClick: (r) => r.querySelector('[name=v]').value }] });
  if (value == null) return;
  await api('PATCH', `/api/tickets/${t.key}`, { [field]: value }).catch((err) => toast(err.message, true));
  await reload();
}

async function reload() {
  data = await api('GET', `/api/tickets/${encodeURIComponent(key)}`);
  draw();
}

export async function onEvent(name) {
  if (name === 'tickets' && mainEl && key && !document.querySelector('.modal-back')) {
    const active = document.activeElement;
    if (active && (active.id === 'note')) return; // don't wipe a note being typed
    await reload().catch(() => {});
  }
}
