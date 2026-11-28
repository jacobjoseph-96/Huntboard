import { app, api, html, raw, md, toast, modal, confirmDialog, moveTicket, interviewDialog, startRun, hasSkill, fitBadge, fitClass, fitText, statusLabel, stageLabel, when, ago, fileUrl, safeUrl, $, $$ } from '../app.js';

let mainEl = null;
let key = null;
let tab = 'posting';
let data = null;
// When the page was last drawn. A live update can redraw it (e.g. the Needs-you banner goes away) just as the user
// clicks, so a different button slides under the pointer: a task button pressed right after a redraw is ignored.
let drawnAt = 0;
const MISCLICK_MS = 600;

const ACTIONS = [
  ['tailor', 'Tailor my CV'],
  ['cover-letter', 'Write a cover letter'],
  ['email', 'Write an e-mail'],
  ['apply', 'Apply'],
  ['interview-prep', 'Prepare for the interview'],
  ['interview-debrief', 'Debrief the interview'],
];

const EDITABLE = [
  ['company', 'Company'], ['location', 'Location'], ['mode', 'On site / hybrid / remote'], ['job_type', 'Job type'],
  ['salary', 'Salary'], ['link', 'Link'], ['source', 'Found on'], ['posted', 'Posted'], ['deadline', 'Apply by'], ['contact', 'Contact person'],
];

// Full path of a file on this computer, to paste into a form's or a mail program's "attach" dialog.
function absPath(base, rel) {
  const sep = String(base).includes('\\') ? '\\' : '/';
  return `${String(base).replace(/[\\/]+$/, '')}${sep}${String(rel).split('/').join(sep)}`;
}

function fileTools(abs, reveal) {
  return html`<div class="path-row"><code class="path" title="${abs}">${abs}</code>
    <button class="btn small ghost" data-copy="${abs}" title="Copy the full path">Copy path</button>
    <button class="btn small ghost" data-reveal="${JSON.stringify(reveal)}" title="Open the folder with this file selected">Show in folder</button></div>`;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  toast('Path copied. Paste it into the file dialog of the form or e-mail.');
}

// What the user told the AI to remember for this job ("Just remember it"); shown only when there is something.
function instructionsCard(t) {
  const i = t.instructions;
  if (!i) return '';
  const who = t.jt ? ', including your tailoring and send agents' : '';
  return html`<div class="card" id="instructions" style="margin-bottom:16px">
    <div class="row"><h3 style="margin:0">The AI remembers for this job</h3><span class="spacer"></span>
      <button class="btn small ghost" id="instr-clear">Remove</button></div>
    <div style="white-space:pre-wrap;margin-top:8px">${i.text}</div>
    <p class="small muted" style="margin:6px 0 0">Saved ${ago(i.at)}. Every AI task on this job follows it${who}. To change it, use "Tell the AI what to do".</p>
  </div>`;
}

// Delete: the folder goes to the trash (restorable) and no search brings the job back.
async function deleteDialog(t) {
  const body = html`<p>Take <b>${t.key} · ${t.company || t.title}</b> off the board? The folder moves to
      <span class="mono">workspace/trash/</span>, so it can be restored (<span class="mono">node tools/hunt.js restore ${t.key}</span>).
      A search will not add this job again.</p>`.s;
  const out = await modal({ title: 'Delete this job?', body, actions: [
    { label: 'Cancel', value: null },
    { label: 'Delete', kind: 'danger', value: {} },
  ] });
  if (!out) return;
  try {
    await api('DELETE', `/api/tickets/${t.key}`, out);
    toast(`${t.key} deleted.`);
    location.hash = '#/board';
  } catch (err) { toast(err.message, true); }
}

// "Tell the AI what to do": the one place to give the AI orders for this job. Nothing happens until something is
// written. "Send to the AI": it does exactly that now, nothing else. "Just remember it": a rule every later AI task
// on this job follows (replaces the earlier one); no task starts. From a Needs-you banner it answers the AI's question.
async function tellDialog(t, { fromNeeds = false } = {}) {
  const words = (r, how) => {
    const v = r.querySelector('[name=tell]').value.trim();
    if (v) return { text: v, how };
    r.querySelector('[data-empty]').hidden = false;
    r.querySelector('[name=tell]').focus();
    return false;
  };
  const out = await modal({
    title: 'Tell the AI what to do',
    wide: true,
    body: html`${fromNeeds && t.needs ? html`<p class="small"><b>The AI asked:</b> ${t.needs.text}</p>` : ''}
      <p class="small muted">Write it as you would to a person. <b>Send to the AI</b>: it does only this, now.
        <b>Just remember it</b>: every later AI task on this job follows it (e.g. when you press Apply).</p>
      ${t.instructions ? html`<p class="small muted">It remembers now: “${t.instructions.text}”. Remembering something new replaces this.</p>` : ''}
      <textarea name="tell" rows="6" style="width:100%" placeholder="${fromNeeds ? 'e.g. It is fine to replace the stored CV: remove it, then attach the new one.' : 'e.g. Make the cover letter shorter and mention my Qt project.'}"></textarea>
      <p class="small" data-empty style="color:var(--danger);margin:6px 0 0" hidden>Write what the AI should do first.</p>`.s,
    actions: [
      { label: 'Cancel', value: null },
      { label: 'Just remember it', onClick: (r) => words(r, 'remember') },
      { label: 'Send to the AI', kind: 'primary', onClick: (r) => words(r, 'run') },
    ],
  });
  if (!out) return;
  if (out.how === 'run' && !app.state.settings.ai.tool) {
    toast('Choose your AI tool in Settings first.', true);
    location.hash = '#/settings?tab=ai';
    return;
  }
  try {
    const res = await api('POST', `/api/tickets/${encodeURIComponent(t.key)}/tell`, { text: out.text, answer_to_needs: fromNeeds, run: out.how === 'run', remember: out.how === 'remember' });
    if (res.run) {
      app.runs.set(res.run.id, res.run);
      toast('The AI started working on it. You can keep using the app.');
    } else toast('Saved. Every AI task on this job will follow it.');
  } catch (err) { toast(err.message, true); }
  await reload();
}

function bindFileTools(root) {
  $$('[data-copy]', root).forEach((b) => b.addEventListener('click', () => copyText(b.dataset.copy)));
  $$('[data-reveal]', root).forEach((b) => b.addEventListener('click', () => api('POST', '/api/reveal', JSON.parse(b.dataset.reveal)).catch((err) => toast(err.message, true))));
}

export async function render(main, { args, query }) {
  mainEl = main;
  key = args[0];
  if (query.tab) tab = query.tab;
  data = await api('GET', `/api/tickets/${encodeURIComponent(key)}`);
  draw();
}

function draw() {
  drawnAt = Date.now();
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
      <button class="btn danger" id="delete" type="button" title="Take this job off the board">Delete</button>
    </div>

    ${t.needs ? html`<div class="notice warn row" style="margin-bottom:12px"><span><b>Needs you:</b> ${t.needs.text}</span><span class="spacer"></span><button class="btn small" id="needs-tell">Tell the AI</button><button class="btn small" id="needs-done">I did it</button></div>` : ''}
    <div class="row" style="margin-bottom:16px">
      <button class="btn" id="tell-ai" type="button" title="Write what the AI should do for this job; it does only that">Tell the AI what to do</button>
      ${ACTIONS.map(([skill, label]) => html`${skill === 'cover-letter' ? html`<button class="btn" id="original-cv" type="button" title="Send the CV you uploaded, exactly as it is (no tailoring)">Use my CV as it is</button>` : ''}<button class="btn ${skill === suggested(t) ? 'primary' : ''}" data-skill="${skill}" ${hasSkill(skill) ? '' : raw('disabled title="Coming in a later version"')}>${label}</button>`)}
    </div>
    ${t.documents && t.documents.cv ? html`<p class="small muted" style="margin:-8px 0 14px">CV for this job: <b>${t.documents.cv_source === 'original' ? 'your own CV, as uploaded' : 'tailored to this job'}</b> (${t.documents.cv.replace(/^docs\//, '')})</p>` : ''}

    ${instructionsCard(t)}
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

  $('#move', mainEl)?.addEventListener('change', async (e) => {
    try {
      const out = await moveTicket(t, e.target.value);
      if (out) { toast(`Moved to ${statusLabel(out.status)}`); await reload(); } else e.target.value = t.status;
    } catch (err) { toast(err.message, true); e.target.value = t.status; }
  });
  $('#delete', mainEl)?.addEventListener('click', () => deleteDialog(t));
  const ic = $('#instr-clear', mainEl);
  if (ic) ic.addEventListener('click', async () => {
    await api('PUT', `/api/tickets/${t.key}/instructions`, { text: null }).catch((err) => toast(err.message, true));
    await reload();
  });
  $('#tell-ai', mainEl)?.addEventListener('click', () => tellDialog(t));
  const nt = $('#needs-tell', mainEl);
  if (nt) nt.addEventListener('click', () => tellDialog(t, { fromNeeds: true }));
  const nd = $('#needs-done', mainEl);
  if (nd) nd.addEventListener('click', async () => { await api('PUT', `/api/tickets/${t.key}/needs`, { text: null }).catch((err) => toast(err.message, true)); await reload(); });
  $$('[data-skill]', mainEl).forEach((b) => b.addEventListener('click', () => {
    if (Date.now() - drawnAt < MISCLICK_MS) return;
    startRun(b.dataset.skill, { ticket: t.key });
  }));
  $('#original-cv', mainEl)?.addEventListener('click', async () => {
    if (t.documents && t.documents.cv && t.documents.cv_source !== 'original'
      && !(await confirmDialog('Use your own CV?', 'This job has a tailored CV. From now on your uploaded CV, unchanged, is the CV for this job (the tailored file stays in Documents).', 'Use my CV'))) return;
    try {
      await api('POST', `/api/tickets/${encodeURIComponent(t.key)}/original-cv`);
      toast('Your own CV is the CV for this job now.');
      tab = 'docs';
      await reload();
    } catch (err) { toast(err.message, true); }
  });
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
      <div class="row end" style="margin-top:12px">
        ${t.link ? html`<button class="btn small" id="fetch-ad" title="${data.posting ? 'Read the ad again from its link and replace the saved text' : 'Read the ad from its link; also fills location, job type, salary, apply-by and contact where empty'}">${data.posting ? 'Fetch the ad again' : 'Fetch the ad'}</button>` : ''}
        <button class="btn small" id="edit-posting">${data.posting ? 'Edit the ad text' : 'Paste the ad text'}</button></div>
      <p class="muted small" style="margin-top:6px">Saving the ad text also fills the empty details (location, on site / hybrid / remote, job type, salary, apply by, contact).</p>`.s;
  }
  if (tab === 'fit') {
    const f = t.fit;
    if (!f) return html`<div class="empty">No fit check yet. The AI scores jobs it finds.</div>`.s;
    return html`<div class="row"><span class="fit ${fitClass(f.score)}" style="font-size:20px;padding:6px 10px">${fitText(f)}</span><b>${f.verdict}</b></div>
      ${f.reasons.length ? html`<h3 style="margin-top:14px">Why it fits</h3><ul>${f.reasons.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
      ${f.red_flags.length ? html`<h3>Watch out</h3><ul>${f.red_flags.map((r) => html`<li>${r}</li>`)}</ul>` : ''}
      ${f.scored_with ? html`<p class="small muted">Scored by ${f.scored_with}</p>` : ''}`.s;
  }
  if (tab === 'docs') {
    const files = data.files.filter((f) => f.path.startsWith('docs/'));
    return html`${files.length ? html`<ul class="files">${files.map((f) => html`<li><span>📄</span><a href="${fileUrl(t.key, f.path)}" target="_blank" rel="noopener">${f.path.slice(5)}</a><span class="spacer"></span><span class="small muted">${ago(f.modified)}</span><a class="btn small ghost" href="${fileUrl(t.key, f.path, true)}">Download</a>${data.dir ? fileTools(absPath(data.dir, f.path), { key: t.key, path: f.path }) : ''}</li>`)}</ul>`
      : html`<div class="empty">No documents for this job yet. Use "Tailor my CV", "Use my CV as it is", "Write a cover letter" or "Write an e-mail".</div>`}`.s;
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
    <label class="field" style="margin-top:14px">Add a note <span class="hint">facts about this job, e.g. "I know the manager". The AI reads them. For what the AI should do, use "Tell the AI what to do" above.</span>
      <textarea id="note" rows="3"></textarea></label>
    <div class="row end" style="margin-top:8px"><button class="btn primary" id="add-note">Add note</button></div>`.s;
}

function bindTab(t) {
  bindFileTools(mainEl);
  const ep = $('#edit-posting', mainEl);
  if (ep) ep.addEventListener('click', async () => {
    const text = await modal({ title: 'Job ad text', wide: true, body: html`<textarea name="p" rows="16" style="width:100%">${data.posting}</textarea>`.s, actions: [{ label: 'Cancel', value: null }, { label: 'Save', kind: 'primary', onClick: (r) => r.querySelector('[name=p]').value }] });
    if (text == null) return;
    await api('PUT', `/api/tickets/${t.key}/posting`, { text }).catch((err) => toast(err.message, true));
    await reload();
  });
  const fa = $('#fetch-ad', mainEl);
  if (fa) fa.addEventListener('click', async () => {
    fa.disabled = true;
    fa.textContent = 'Fetching…';
    try {
      const r = await api('POST', `/api/tickets/${t.key}/fetch-ad`, { replace: Boolean(data.posting) });
      toast(`${r.saved ? `Saved the ad text from ${r.from}` : 'The ad text was already saved'}${r.filled.length ? `; filled ${r.filled.join(', ')}` : '; no empty detail it could fill'}`);
    } catch (err) {
      toast(err.message, true);
    }
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
