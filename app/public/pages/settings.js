import { app, api, html, toast, refreshState, $, $$ } from '../app.js';
import * as F from './forms.js';

let mainEl = null;
let tab = 'search';
let profile = null;

const TABS = [['search', 'What I am looking for'], ['place', 'Where'], ['apply', 'Applying'], ['ai', 'AI tool'], ['lang', 'Languages & more']];

export async function render(main, { query } = {}) {
  mainEl = main;
  if (query && query.tab) tab = query.tab;
  await refreshState();
  profile = JSON.parse(JSON.stringify(app.state.profile));
  main.innerHTML = html`<div class="page">
    <div class="page-head"><div class="grow"><h1>Settings</h1><p class="muted">What to look for, where, how far the AI may go, and which AI does the work.</p></div></div>
    <div class="tabs">${TABS.map(([id, label]) => html`<button data-tab="${id}" class="${tab === id ? 'active' : ''}">${label}</button>`)}</div>
    <div id="pane"></div></div>`.s;
  $$('[data-tab]', main).forEach((b) => b.addEventListener('click', () => { collect(); tab = b.dataset.tab; render(main); }));
  await drawPane();
}

async function drawPane() {
  const pane = $('#pane', mainEl);
  const saveBtn = html`<div class="row end" style="margin-top:16px"><button class="btn primary big" id="save">Save</button></div>`;
  if (tab === 'search') {
    pane.innerHTML = html`<div class="card"><h2>Your searches</h2><p class="muted">Each search has a job type and says which jobs you want. The AI picks the best job boards for each one.</p>${F.raw(F.targetsSection(profile))}</div>${saveBtn}`.s;
    F.bindTargets(pane, profile);
  } else if (tab === 'place') {
    pane.innerHTML = html`<div class="card"><h2>Where you live and work</h2>${F.raw(F.locationSection(profile))}</div>
      <div class="card"><h2>About you</h2>${F.raw(F.aboutSection(profile))}</div>${saveBtn}`.s;
    F.bindLocation(pane);
    F.bindAbout(pane);
  } else if (tab === 'apply') {
    pane.innerHTML = html`<div class="card"><h2>Should the AI apply for you?</h2>${F.raw(F.applySection(profile))}</div>${saveBtn}`.s;
    F.bindApply(pane);
  } else if (tab === 'lang') {
    const s = app.state.settings;
    pane.innerHTML = html`<div class="card"><h2>Languages</h2>${F.raw(F.languageSection(profile))}</div>
      <div class="card"><h2>Reminders</h2><label class="field" style="max-width:280px">Remind me to follow up after (days without an answer)
        <input type="number" name="fu_days" min="3" max="60" value="${s.followup_days}"></label></div>${saveBtn}`.s;
  } else if (tab === 'ai') {
    pane.innerHTML = await aiPane();
    bindAi(pane);
    return;
  }
  $('#save', pane).addEventListener('click', save);
}

function collect() {
  const pane = $('#pane', mainEl);
  if (!pane) return;
  if (tab === 'search' && $('#targets', pane)) F.readTargets(pane, profile);
  if (tab === 'place' && $('[name=l_city]', pane)) { F.readLocation(pane, profile); F.readAbout(pane, profile); }
  if (tab === 'apply' && $('[name=ap_mode]', pane)) F.readApply(pane, profile);
  if (tab === 'lang' && $('[name=lg_docs]', pane)) F.readLanguage(pane, profile);
}

async function save() {
  collect();
  try {
    profile = await api('PUT', '/api/profile', profile);
    if (tab === 'lang') await api('PUT', '/api/settings', { followup_days: Number($('[name=fu_days]', mainEl).value) || 10 });
    await refreshState();
    toast('Saved');
  } catch (err) {
    toast(err.message, true);
  }
}

// ---- AI tool -------------------------------------------------------------------------------------------
async function aiPane() {
  app.tools = await api('GET', '/api/ai/tools');
  const s = app.state.settings;
  const tools = app.tools.tools;
  return html`<div class="card"><h2>Which AI does the work?</h2>
    <p class="muted">Huntboard does not include an AI. It uses an AI tool installed on this computer, with your own account. Free option: Gemini (Antigravity CLI or Gemini CLI). Any model, including local ones: OpenCode.</p>
    <div class="choice-cards">${tools.map((t) => html`<label class="choice-card"><input type="radio" name="tool" value="${t.id}" ${s.ai.tool === t.id ? 'checked' : ''} ${t.runnable ? '' : 'disabled'}>
      <span style="flex:1"><b>${t.name}</b>
        <span class="row small" style="gap:6px;margin-top:2px">${t.runnable ? html`<span class="badge ok">installed</span>` : t.installed ? html`<span class="badge warn">found, cannot start</span>` : html`<span class="badge">not installed</span>`}
          ${t.verified ? '' : html`<span class="badge info">experimental</span>`}
          ${t.runnable ? '' : html`<span class="hint">Install: <span class="mono">${t.install}</span></span>`}</span></span></label>`)}</div>
    <div class="form-grid" style="margin-top:14px">
      <label class="field">Model <span class="hint">optional; empty = the tool's default</span><input type="text" name="model" value="${s.ai.model}"></label>
    </div>
    <label class="check" style="margin-top:12px"><input type="checkbox" name="auto_prep" ${s.ai.auto_prepare_interviews ? 'checked' : ''}> Start interview preparation automatically when I move a job to "Interview"</label>
    <label class="check" style="margin-top:8px"><input type="checkbox" name="full" ${(s.ai.full_access || {})[s.ai.tool] ? 'checked' : ''}> Let the AI work without asking <span class="hint">(needed by some tools for browsing and forms; the AI can then run any command in this folder)</span></label>
    <div class="row" style="margin-top:16px"><button class="btn primary" id="save-ai">Save</button><button class="btn" id="test-ai">Test the AI</button>
      <span class="hint">The first time, sign in once: open a terminal in the Huntboard folder and start the tool (e.g. <span class="mono">${(tools.find((t) => t.id === s.ai.tool) || tools[0] || {}).sign_in || ''}</span>).</span></div>
    <div id="test-out" style="margin-top:10px"></div>
  </div>`.s;
}

function bindAi(pane) {
  const readAi = () => {
    const tool = ($('[name=tool]:checked', pane) || {}).value || '';
    const full = { ...(app.state.settings.ai.full_access || {}) };
    if (tool) full[tool] = $('[name=full]', pane).checked;
    return { ai: { tool, model: $('[name=model]', pane).value.trim(), auto_prepare_interviews: $('[name=auto_prep]', pane).checked, full_access: full } };
  };
  $('#save-ai', pane).addEventListener('click', async () => {
    try {
      await api('PUT', '/api/settings', readAi());
      await refreshState();
      toast('Saved');
    } catch (err) { toast(err.message, true); }
  });
  $('#test-ai', pane).addEventListener('click', async () => {
    await api('PUT', '/api/settings', readAi());
    await refreshState();
    if (!app.state.settings.ai.tool) return toast('Choose an AI tool first.', true);
    const run = await api('POST', '/api/ai/test').catch((err) => toast(err.message, true));
    if (!run) return;
    app.runs.set(run.id, run);
    $('#test-out', pane).innerHTML = html`<div class="row"><span class="spinner"></span> Asking the AI to answer "OK"…</div>`.s;
    testRunId = run.id;
  });
}

let testRunId = null;
export function onEvent(name, data) {
  if (name === 'run' && data.id === testRunId && ['done', 'failed', 'cancelled'].includes(data.status)) {
    const out = document.querySelector('#test-out');
    if (!out) return;
    out.innerHTML = data.status === 'done'
      ? html`<div class="notice ok">It works. The AI answered: <b>${(data.result_text || '').slice(0, 80)}</b></div>`.s
      : html`<div class="notice bad">${data.error || 'The test failed.'}</div>`.s;
  }
}

export function leave() {
  collect();
}
