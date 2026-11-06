import { app, api, html, raw, toast, startRun, hasSkill, refreshState, $, $$ } from '../app.js';
import * as F from './forms.js';
import { documentsBlock, bindDocuments } from './profile.js';

const STEPS = ['Welcome', 'Your AI', 'Documents', 'Where', 'What jobs', 'About you', 'Applying', 'Done'];
let step = 0;
let profile = null;
let mainEl = null;

export async function render(main) {
  mainEl = main;
  await refreshState();
  if (!profile) profile = JSON.parse(JSON.stringify(app.state.profile));
  main.innerHTML = html`<div class="page"><div class="wizard">
    <div class="row"><img src="/assets/logo/huntboard-mark.svg" alt="" width="40" height="40"><h1 style="margin:0">Set up Huntboard</h1><span class="spacer"></span>
      <a class="small" href="#/home" id="skip">Skip for now</a></div>
    <div class="wiz-steps">${STEPS.map((s, i) => html`<span class="${i === step ? 'cur' : i < step ? 'done' : ''}">${i + 1}. ${s}</span>`)}</div>
    <div class="card" id="step">${raw(body())}</div>
    <div class="row" style="margin-top:14px">${step > 0 ? html`<button class="btn" id="back">Back</button>` : ''}<span class="spacer"></span>
      ${step < STEPS.length - 1 ? html`<button class="btn primary big" id="next">${step === 0 ? "Let's start" : 'Next'}</button>` : html`<button class="btn primary big" id="finish">Go to Huntboard</button>`}</div>
  </div></div>`.s;
  bind();
}

function body() {
  const s = app.state;
  switch (STEPS[step]) {
    case 'Welcome':
      return html`<h2>Find the right jobs, apply faster, walk into interviews prepared</h2>
        <ol class="steps-list" style="margin-top:12px">
          <li><span class="n">1</span>You upload your CV and documents and say what kind of job you want and where.</li>
          <li><span class="n">2</span>The AI picks the right job boards for you, searches them and puts the jobs that fit on your board.</li>
          <li><span class="n">3</span>For each job it can tailor your CV, write a letter and, if you allow it, apply.</li>
          <li><span class="n">4</span>When you get an interview, it prepares you for exactly that step.</li>
        </ol>
        <p class="muted" style="margin-top:12px">Your data stays on this computer. It is only sent to the AI tool you choose, and to employers when you apply.</p>`.s;
    case 'Your AI': {
      const tools = app.tools.tools;
      return html`<h2>Which AI should do the work?</h2>
        <p class="muted">Huntboard uses an AI tool installed on this computer with your own account. If you have none: the Gemini tools are free with a Google account.</p>
        <div class="choice-cards">${tools.map((t) => html`<label class="choice-card"><input type="radio" name="tool" value="${t.id}" ${s.settings.ai.tool === t.id ? 'checked' : ''} ${t.runnable ? '' : 'disabled'}>
          <span><b>${t.name}</b> ${t.runnable ? html`<span class="badge ok">installed</span>` : html`<span class="badge">not installed</span> <span class="hint mono">${t.install}</span>`} ${t.verified ? '' : html`<span class="badge info">experimental</span>`}</span></label>`)}</div>
        <p class="hint" style="margin-top:10px">You can change this later in Settings → AI tool, and test it there.</p>`.s;
    }
    case 'Documents':
      return html`<h2>Your CV and documents</h2>${raw(documentsBlock())}
        ${hasSkill('setup') ? html`<div class="notice" style="margin-top:12px">After uploading, the AI can read your CV and fill in the next steps for you.
          <button class="btn small primary" id="ai-read" style="margin-left:8px">Let the AI read my CV</button></div>` : ''}`.s;
    case 'Where':
      return html`<h2>Where do you live?</h2><p class="muted">Jobs are searched around this place.</p>${F.raw(F.locationSection(profile))}`.s;
    case 'What jobs':
      return html`<h2>What kind of job are you looking for?</h2>${F.raw(F.targetsSection(profile))}`.s;
    case 'About you':
      return html`<h2>A few facts about you</h2><p class="muted">The AI uses these to judge which jobs you can do. Leave empty what you don't know.</p>${F.raw(F.aboutSection(profile))}
        <h3 style="margin-top:16px">Language</h3>${F.raw(F.languageSection(profile))}`.s;
    case 'Applying':
      return html`<h2>Should the AI apply for you?</h2>${F.raw(F.applySection(profile))}`.s;
    default:
      return html`<h2>All set 🎉</h2><p>Next: open <b>Find jobs</b> and start your first search, or add a job you already found on the <b>Board</b>.</p>`.s;
  }
}

function bind() {
  const root = $('#step', mainEl);
  const name = STEPS[step];
  if (name === 'Documents') {
    bindDocuments(root, () => render(mainEl));
    const ai = $('#ai-read', root);
    if (ai) ai.addEventListener('click', async () => {
      if (!app.state.documents.some((d) => d.type === 'cv')) return toast('Upload your CV first.', true);
      const run = await startRun('setup');
      if (run) profile = null; // reload the profile the AI fills in
    });
  }
  if (name === 'Where') F.bindLocation(root);
  if (name === 'What jobs') F.bindTargets(root, profile);
  if (name === 'About you') F.bindAbout(root);
  if (name === 'Applying') F.bindApply(root);
  const next = $('#next', mainEl);
  if (next) next.addEventListener('click', async () => { if (await saveStep()) { step++; render(mainEl); } });
  const back = $('#back', mainEl);
  if (back) back.addEventListener('click', async () => { await saveStep(); step--; render(mainEl); });
  const finish = $('#finish', mainEl);
  if (finish) finish.addEventListener('click', done);
  $('#skip', mainEl).addEventListener('click', async (e) => { e.preventDefault(); await saveStep(); await done(); });
}

async function saveStep() {
  const root = $('#step', mainEl);
  const name = STEPS[step];
  try {
    if (name === 'Your AI') {
      const tool = ($('[name=tool]:checked', root) || {}).value;
      if (tool) await api('PUT', '/api/settings', { ai: { tool } });
      await refreshState();
      return true;
    }
    if (!profile) profile = JSON.parse(JSON.stringify((await refreshState()).profile));
    if (name === 'Where') {
      F.readLocation(root, profile);
      if (!profile.location.city || !profile.location.country) { toast('Please enter your city and country.', true); return false; }
    }
    if (name === 'What jobs') F.readTargets(root, profile);
    if (name === 'About you') { F.readAbout(root, profile); F.readLanguage(root, profile); }
    if (name === 'Applying') F.readApply(root, profile);
    if (['Where', 'What jobs', 'About you', 'Applying'].includes(name)) {
      const fresh = await api('GET', '/api/profile');
      profile = await api('PUT', '/api/profile', { ...fresh, location: profile.location, targets: profile.targets, about: profile.about, applying: profile.applying, documents_language: profile.documents_language, reply_language: profile.reply_language });
    }
    return true;
  } catch (err) {
    toast(err.message, true);
    return false;
  }
}

async function done() {
  await api('PUT', '/api/settings', { onboarding_done: true });
  await refreshState();
  step = 0;
  profile = null;
  location.hash = '#/home';
}

export function onEvent(name) {
  // The AI filled in the profile while the wizard is open: take its values for the next steps.
  if (name === 'profile' && mainEl && STEPS[step] === 'Documents') { profile = null; render(mainEl); }
}

export { $$ };
