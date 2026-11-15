import { app, api, apiKeepalive, html, toast, confirmDialog, refreshState, $, $$ } from '../app.js';
import * as F from './forms.js';

let mainEl = null;
let tab = 'search';
let profile = null;

const TABS = [['search', 'What I am looking for'], ['place', 'Where'], ['apply', 'Applying'], ['ai', 'AI tool'], ['lang', 'Languages & more'], ['update', 'Updates']];
// The parts of the profile each tab edits: a save sends only these, so it never undoes what changed elsewhere.
const SECTIONS = { search: ['targets'], place: ['location', 'about'], apply: ['applying'], lang: ['documents_language', 'reply_language'] };
const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- autosave -------------------------------------------------------------------------------------------
// Every change is saved by itself a moment after typing stops, and at once when you switch tab, leave the page or
// close the window. The Save button saves right away.
let dirty = false;
let timer = null;
let saving = Promise.resolve();

function setStatus(kind, text) {
  const el = mainEl && $('#save-status', mainEl);
  if (!el) return;
  el.className = `small ${kind === 'error' ? 'bad-text' : 'muted'}`;
  el.textContent = text || { saved: 'All changes saved', saving: 'Saving…', dirty: 'Not saved yet…' }[kind] || '';
}

function markDirty() {
  if (tab === 'update') return;
  dirty = true;
  setStatus('dirty');
  clearTimeout(timer);
  timer = setTimeout(() => flush(), 700);
}

// What this tab would save now: { profile: {section: value}, settings: {...} }.
function payload() {
  collect();
  const out = {};
  if (SECTIONS[tab]) out.profile = Object.fromEntries(SECTIONS[tab].map((k) => [k, profile[k]]));
  if (tab === 'lang' && $('[name=fu_days]', mainEl)) out.settings = { followup_days: Number($('[name=fu_days]', mainEl).value) || 10 };
  if (tab === 'ai' && $('[name=tool]', mainEl)) out.settings = readAi($('#pane', mainEl));
  return out;
}

function flush() {
  clearTimeout(timer);
  if (!dirty || !mainEl || !$('#pane', mainEl)) return saving;
  dirty = false;
  const body = payload();
  setStatus('saving');
  saving = saving.then(async () => {
    try {
      if (body.profile) {
        const out = await api('PATCH', '/api/profile', body.profile);
        // Keep the server's tidied values (e.g. the generated name of an unnamed search) without redrawing.
        for (const k of Object.keys(body.profile)) profile[k] = out[k];
      }
      if (body.settings) await api('PUT', '/api/settings', body.settings);
      await refreshState();
      if (!dirty) setStatus('saved');
    } catch (err) {
      dirty = true;
      setStatus('error', `Not saved: ${err.message}`);
    }
  });
  return saving;
}

// The window is closing: send what is left in a way the browser still delivers.
function flushNow() {
  if (!dirty || !mainEl || !$('#pane', mainEl)) return;
  dirty = false;
  const body = payload();
  if (body.profile) apiKeepalive('PATCH', '/api/profile', body.profile);
  if (body.settings) apiKeepalive('PUT', '/api/settings', body.settings);
}
window.addEventListener('pagehide', () => { if (app.pageName === 'settings') flushNow(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && app.pageName === 'settings') flushNow(); });

// ---- page -------------------------------------------------------------------------------------------------
export async function render(main, { query } = {}) {
  mainEl = main;
  if (query && query.tab && TABS.some(([id]) => id === query.tab)) tab = query.tab;
  await saving;
  await refreshState();
  profile = clone(app.state.profile);
  main.innerHTML = html`<div class="page">
    <div class="page-head"><div class="grow"><h1>Settings</h1><p class="muted">What to look for, where, how far the AI may go, and which AI does the work. Changes are saved by themselves.</p></div></div>
    <div class="tabs">${TABS.map(([id, label]) => html`<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`)}</div>
    <div id="pane"></div></div>`.s;
  // Typing, picking and the add/remove buttons all count as changes.
  const pane = $('#pane', main);
  pane.addEventListener('input', markDirty);
  pane.addEventListener('change', markDirty);
  pane.addEventListener('click', (e) => { if (e.target.closest('button[type=button]:not(#save):not(#clear):not(#test-ai):not(#m-suggest):not(#upd-go):not(#upd-check)')) setTimeout(markDirty, 0); });
  $$('[data-tab]', main).forEach((b) => b.addEventListener('click', async () => {
    await flush();
    tab = b.dataset.tab;
    render(main);
  }));
  await drawPane();
}

const saveBar = () => html`<div class="row end" style="margin-top:16px">
  <span id="save-status" class="small muted">All changes saved</span><span class="spacer"></span>
  <button class="btn ghost danger" id="clear" type="button" title="Empty the fields on this tab">Clear</button>
  <button class="btn primary big" id="save" type="button">Save</button></div>`;

async function drawPane() {
  const pane = $('#pane', mainEl);
  if (tab === 'search') {
    pane.innerHTML = html`<div class="card"><h2>Your searches</h2><p class="muted">Each search has a job type and says which jobs you want. The AI picks the best job boards for each one.</p>${F.raw(F.targetsSection(profile))}</div>${saveBar()}`.s;
    F.bindTargets(pane, profile);
  } else if (tab === 'place') {
    pane.innerHTML = html`<div class="card"><h2>Where you live and where to search</h2>${F.raw(F.locationSection(profile))}</div>
      <div class="card"><h2>About you</h2>${F.raw(F.aboutSection(profile))}</div>${saveBar()}`.s;
    F.bindLocation(pane);
    F.bindAbout(pane);
  } else if (tab === 'apply') {
    pane.innerHTML = html`<div class="card"><h2>Should the AI apply for you?</h2>${F.raw(F.applySection(profile))}</div>${saveBar()}`.s;
    F.bindApply(pane);
  } else if (tab === 'lang') {
    const s = app.state.settings;
    pane.innerHTML = html`<div class="card"><h2>Languages</h2>${F.raw(F.languageSection(profile))}</div>
      <div class="card"><h2>Reminders</h2><label class="field" style="max-width:280px">Remind me to follow up after (days without an answer)
        <input type="number" name="fu_days" min="3" max="60" value="${s.followup_days}"></label></div>${saveBar()}`.s;
  } else if (tab === 'ai') {
    pane.innerHTML = (await aiPane()) + saveBar().s;
    bindAi(pane);
  } else if (tab === 'update') {
    pane.innerHTML = html`<div class="card" id="update-card"><p class="muted"><span class="spinner"></span> Looking for a newer version…</p></div>`.s;
    drawUpdate(false);
    return;
  }
  $('#save', pane).addEventListener('click', async () => {
    dirty = true;
    await flush();
    if (!dirty) toast('Saved');
  });
  $('#clear', pane).addEventListener('click', clearTab);
}

function collect() {
  const pane = $('#pane', mainEl);
  if (!pane) return;
  if (tab === 'search' && $('#targets', pane)) F.readTargets(pane, profile);
  if (tab === 'place' && $('[name=l_city]', pane)) { F.readLocation(pane, profile); F.readAbout(pane, profile); }
  if (tab === 'apply' && $('[name=ap_mode]', pane)) F.readApply(pane, profile);
  if (tab === 'lang' && $('[name=lg_docs]', pane)) F.readLanguage(pane, profile);
}

// Clear: this tab's fields go back to how a new Huntboard has them (after a yes).
const CLEAR_TEXT = {
  search: 'All your searches are replaced by one empty search. The jobs on your board stay.',
  place: 'Where you live, the places to search and what you told about yourself are emptied.',
  apply: 'The applying mode, limits and your standard form answers go back to the defaults.',
  lang: 'The languages and the reminder go back to the defaults.',
  ai: 'The models, the task list and the switches on this tab go back to the defaults. The AI tool stays chosen.',
};
async function clearTab() {
  if (!(await confirmDialog('Clear this tab?', CLEAR_TEXT[tab], 'Clear'))) return;
  const d = clone(app.meta.defaults.profile);
  if (SECTIONS[tab]) for (const k of SECTIONS[tab]) profile[k] = clone(d[k]);
  if (tab === 'lang') {
    await api('PUT', '/api/settings', { followup_days: app.meta.defaults.followup_days }).catch((err) => toast(err.message, true));
  }
  if (tab === 'ai') {
    const s = app.state.settings;
    await api('PUT', '/api/settings', { ai: { model: '', models: { [s.ai.tool]: { light: '', standard: '', strong: '' } }, task_tiers: Object.fromEntries(Object.keys(app.meta.model_tiers.tasks).map((k) => [k, ''])), auto_prepare_interviews: false, full_access: { [s.ai.tool]: false } } }).catch((err) => toast(err.message, true));
    await refreshState();
  }
  await drawPane();
  if (SECTIONS[tab]) {
    dirty = true;
    await flush();
  }
  toast('Cleared');
}

// ---- AI tool -------------------------------------------------------------------------------------------
const TASK_LABEL = { chat: 'Chat with the AI', test: 'Test the AI' };
const TIER_LABEL = { light: 'Light', standard: 'Standard', strong: 'Strong' };

async function aiPane() {
  app.tools = await api('GET', '/api/ai/tools');
  const s = app.state.settings;
  const tools = app.tools.tools;
  const tool = tools.find((t) => t.id === s.ai.tool);
  const mine = (s.ai.models || {})[s.ai.tool] || {};
  const m = { light: mine.light || '', standard: mine.standard || (mine.light || mine.strong ? '' : s.ai.model || ''), strong: mine.strong || '' };
  const tiers = app.meta.model_tiers;
  const ownTiers = s.ai.task_tiers || {};
  return html`<div class="card"><h2>Which AI does the work?</h2>
    <p class="muted">Huntboard does not include an AI. It uses an AI tool installed on this computer, with your own account. Free option: Gemini (Antigravity CLI or Gemini CLI). Any model, including local ones: OpenCode.</p>
    <div class="choice-cards">${tools.map((t) => html`<label class="choice-card"><input type="radio" name="tool" value="${t.id}" ${s.ai.tool === t.id ? 'checked' : ''} ${t.runnable ? '' : 'disabled'}>
      <span style="flex:1"><b>${t.name}</b>
        <span class="row small" style="gap:6px;margin-top:2px">${t.runnable ? html`<span class="badge ok">installed</span>` : t.installed ? html`<span class="badge warn">found, cannot start</span>` : html`<span class="badge">not installed</span>`}
          ${t.verified ? '' : html`<span class="badge info">experimental</span>`}
          ${t.runnable ? '' : html`<span class="hint">Install: <span class="mono">${t.install}</span></span>`}</span></span></label>`)}</div>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="auto_prep" ${s.ai.auto_prepare_interviews ? 'checked' : ''}> Start interview preparation automatically when I move a job to "Interview"</label>
    <label class="check" style="margin-top:8px"><input type="checkbox" name="full" ${(s.ai.full_access || {})[s.ai.tool] ? 'checked' : ''}> Let the AI work without asking <span class="hint">(needed by some tools for browsing and forms; the AI can then run any command in this folder)</span></label>
    <div class="row" style="margin-top:16px"><button class="btn" id="test-ai" type="button">Test the AI</button>
      <span class="hint">The first time, sign in once: open a terminal in the Huntboard folder and start the tool (e.g. <span class="mono">${(tool || tools[0] || {}).sign_in || ''}</span>).</span></div>
    <div id="test-out" style="margin-top:10px"></div>
  </div>
  <div class="card"><h2>Models: the right one for each task</h2>
    <p class="muted">A big model for a small job only uses up your limit. Give simple tasks a small, fast model and keep the strongest
      one for your CV, letters and interviews, where every word counts. Leave a box empty to use ${tool ? tool.name.split(' (')[0] : 'the tool'}'s own default.</p>
    <div class="form-grid" style="margin-top:8px">
      <label class="field">Light <span class="hint">tests, follow-up messages</span><input type="text" name="m_light" value="${m.light}" placeholder="${(tool && tool.models && tool.models.light) || 'e.g. a small, fast model'}"></label>
      <label class="field">Standard <span class="hint">searching, applying, chat</span><input type="text" name="m_standard" value="${m.standard}" placeholder="${(tool && tool.models && tool.models.standard) || 'the tool’s default'}"></label>
      <label class="field">Strong <span class="hint">CV, cover letters, e-mails, interviews</span><input type="text" name="m_strong" value="${m.strong}" placeholder="${(tool && tool.models && tool.models.strong) || 'the most capable model'}"></label>
    </div>
    ${tool && tool.models ? html`<div class="row" style="margin-top:10px"><button class="btn small" id="m-suggest" type="button">Use the suggested models</button>
      <span class="hint">${tool.name}: ${tiers.tiers.map((t) => `${TIER_LABEL[t]} = ${tool.models[t]}`).join(', ')}</span></div>`
      : html`<p class="hint" style="margin-top:8px">Model names depend on the tool and your plan; the tool's own help lists them (an empty box always works).</p>`}
    <details style="margin-top:12px"><summary class="small">Which task uses which model</summary>
      <div class="form-grid" style="margin-top:8px">${Object.keys(tiers.tasks).map((k) => html`<label class="field">${TASK_LABEL[k] || app.meta.tasks[k] || k}
        <select name="tier_${k}">${tiers.tiers.map((t) => html`<option value="${t}" ${(ownTiers[k] || tiers.tasks[k]) === t ? 'selected' : ''}>${TIER_LABEL[t]}${tiers.tasks[k] === t ? ' (default)' : ''}</option>`)}</select></label>`)}</div>
    </details>
  </div>`.s;
}

function readAi(pane) {
  const tool = ($('[name=tool]:checked', pane) || {}).value || '';
  const full = { ...(app.state.settings.ai.full_access || {}) };
  if (tool) full[tool] = $('[name=full]', pane).checked;
  const models = { light: $('[name=m_light]', pane).value.trim(), standard: $('[name=m_standard]', pane).value.trim(), strong: $('[name=m_strong]', pane).value.trim() };
  const tiers = app.meta.model_tiers;
  const taskTiers = {};
  for (const k of Object.keys(tiers.tasks)) {
    const v = ($(`[name=tier_${k}]`, pane) || {}).value;
    taskTiers[k] = v && v !== tiers.tasks[k] ? v : '';
  }
  const ai = { tool, auto_prepare_interviews: $('[name=auto_prep]', pane).checked, full_access: full, task_tiers: taskTiers };
  // The models belong to the tool they were typed for: switching tool shows that tool's models.
  if (tool === app.state.settings.ai.tool) Object.assign(ai, { models: { [tool]: models }, model: models.standard });
  return ai;
}

function bindAi(pane) {
  $$('[name=tool]', pane).forEach((r) => r.addEventListener('change', async () => {
    dirty = true;
    await flush();
    drawPane();
  }));
  const sug = $('#m-suggest', pane);
  if (sug) sug.addEventListener('click', () => {
    const t = app.tools.tools.find((x) => x.id === app.state.settings.ai.tool);
    for (const k of ['light', 'standard', 'strong']) $(`[name=m_${k}]`, pane).value = t.models[k] || '';
    markDirty();
  });
  $('#test-ai', pane).addEventListener('click', async () => {
    dirty = true;
    await flush();
    if (!app.state.settings.ai.tool) return toast('Choose an AI tool first.', true);
    const run = await api('POST', '/api/ai/test').catch((err) => toast(err.message, true));
    if (!run) return;
    app.runs.set(run.id, run);
    $('#test-out', pane).innerHTML = html`<div class="row"><span class="spinner"></span> Asking the AI to answer "OK"${run.model ? ` (model ${run.model})` : ''}…</div>`.s;
    testRunId = run.id;
  });
}

// ---- updates ---------------------------------------------------------------------------------------------
let updateLog = [];
let updating = false;

async function drawUpdate(fresh) {
  const card = mainEl && $('#update-card', mainEl);
  if (!card) return;
  let info;
  try {
    info = await api('GET', `/api/update/check${fresh ? '?fresh=1' : ''}`);
  } catch (err) {
    info = { error: err.message };
  }
  const status = await api('GET', '/api/update/status').catch(() => ({}));
  if (status.running) { updating = true; updateLog = status.log || []; }
  const v = app.meta.version;
  card.innerHTML = html`<h2>Updates</h2>
    <p>You have Huntboard <b>${v}</b>${info.type ? html` <span class="hint">(${info.type === 'git' ? 'installed with git' : 'installed from a download'})</span>` : ''}.</p>
    ${info.error ? html`<div class="notice warn">${info.error}</div>`
      : info.available ? html`<div class="notice ok"><b>A new version is ready${info.latest && info.latest !== v ? `: ${info.latest}` : ''}.</b>${info.behind ? ` ${info.behind} change${info.behind === 1 ? '' : 's'}.` : ''}
          ${info.changes && info.changes.length ? html`<ul class="small" style="margin:6px 0 0">${info.changes.slice(0, 10).map((c) => html`<li>${c}</li>`)}</ul>` : ''}</div>`
      : html`<div class="notice">${info.unknown ? 'This download does not know its exact version. "Update now" installs the newest one anyway.' : 'You have the newest version.'}</div>`}
    ${info.blocked && info.blocked.length ? html`<div class="notice warn" style="margin-top:8px">Some program files were changed on this computer (${info.blocked.slice(0, 5).join(', ')}). The update stops instead of overwriting them.</div>` : ''}
    <p class="muted small" style="margin-top:10px">Your data stays as it is: CV, documents, jobs, settings and logins live in the <span class="mono">workspace</span> folder, which an update never changes.
      A backup of it is made first (<span class="mono">workspace/backups/</span>, the last 3 are kept). Afterwards Huntboard restarts by itself.</p>
    <div class="row" style="margin-top:12px">
      <button class="btn primary" id="upd-go" type="button" ${updating || info.error ? 'disabled' : ''}>${updating ? 'Updating…' : 'Update now'}</button>
      <button class="btn" id="upd-check" type="button" ${updating ? 'disabled' : ''}>Check again</button></div>
    <ul id="upd-log" class="steps small" style="margin-top:10px">${updateLog.map((l) => html`<li>${l}</li>`)}</ul>
    <p class="hint" style="margin-top:8px">Without the app: double-click <span class="mono">update.bat</span> (Windows) or run <span class="mono">sh update.sh</span>.</p>`.s;
  $('#upd-check', card).addEventListener('click', () => { card.innerHTML = html`<p class="muted"><span class="spinner"></span> Checking…</p>`.s; drawUpdate(true); });
  $('#upd-go', card).addEventListener('click', async () => {
    if (!(await confirmDialog('Update Huntboard now?', 'Your data is backed up first and stays as it is. The app restarts when the update is done (about a minute).', 'Update now'))) return;
    try {
      await api('POST', '/api/update/apply');
      updating = true;
      updateLog = [];
      drawUpdate(false);
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// After the update the server restarts: wait until the new one answers, then load the page again.
async function waitForRestart() {
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const s = await api('GET', '/api/update/status');
      if (!s.running && !s.done) { location.reload(); return; }
    } catch { /* restarting */ }
  }
}

let testRunId = null;
export function onEvent(name, data) {
  if (name === 'update' && data) {
    if (data.text) {
      updateLog.push(data.text);
      const ul = document.querySelector('#upd-log');
      if (ul) ul.insertAdjacentHTML('beforeend', html`<li>${data.text}</li>`.s);
    }
    if (data.error) {
      updating = false;
      toast(`The update did not finish: ${data.error}`, true);
      if (tab === 'update') drawUpdate(false);
    }
    if (data.done) {
      toast(`Updated to ${data.done.to}. Huntboard restarts…`);
      waitForRestart();
    }
  }
  if (name === 'run' && data.id === testRunId && ['done', 'failed', 'cancelled'].includes(data.status)) {
    const out = document.querySelector('#test-out');
    if (!out) return;
    out.innerHTML = data.status === 'done'
      ? html`<div class="notice ok">It works. The AI answered: <b>${(data.result_text || '').slice(0, 80)}</b></div>`.s
      : html`<div class="notice bad">${data.error || 'The test failed.'}</div>`.s;
  }
}

export function leave() {
  flush();
}
