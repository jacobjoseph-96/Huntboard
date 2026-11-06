// Form sections shared by the Settings page, the Profile page and the setup wizard.
// Each section: render(profileOrSettings) → HTML string, read(root, profile) → updates the object in place.

import { app, html, raw, $, $$ } from '../app.js';

// ---- search targets ----------------------------------------------------------------------------
export function targetsSection(profile) {
  return html`<div id="targets">${profile.targets.map((t, i) => targetBox(t, i))}</div>
    <div class="row" style="margin-top:10px"><button class="btn" type="button" id="add-target">+ Add another search</button>
      <span class="hint">Example: one search for full-time jobs in your field and one for any mini-job nearby.</span></div>`.s;
}

function targetBox(t, i) {
  const suggested = app.state.profile.suggested_roles || [];
  return html`<div class="target" data-target="${i}">
    <div class="row"><input type="text" name="t_name" value="${t.name}" placeholder="Name of this search" style="max-width:340px">
      <label class="check small"><input type="checkbox" name="t_active" ${t.active ? 'checked' : ''}> active</label>
      <span class="spacer"></span><button class="btn small ghost danger" type="button" data-remove="${i}">Remove</button></div>
    <div style="margin-top:10px"><b class="small">Type of job</b>
      <div class="row" style="margin-top:6px">${app.meta.job_types.map((j) => html`<label class="chip" style="cursor:pointer"><input type="checkbox" name="t_types" value="${j.id}" ${t.job_types.includes(j.id) ? 'checked' : ''}> ${j.label}</label>`)}</div></div>
    <div style="margin-top:12px"><b class="small">Which jobs?</b>
      <div class="choice-cards" style="margin-top:6px">
        ${app.meta.role_scopes.map((r) => html`<label class="choice-card"><input type="radio" name="t_scope_${i}" value="${r.id}" ${t.roles.scope === r.id ? 'checked' : ''}>
          <span><b>${r.label}</b>${r.id === 'cv' ? html`<span class="hint">${suggested.length ? `From your CV: ${suggested.slice(0, 6).join(', ')}` : 'The AI reads your CV and picks matching job titles.'}</span>`
            : r.id === 'any' ? html`<span class="hint">e.g. a software engineer looking for a mini-job also gets waiter, shop and warehouse jobs. The AI checks hours, distance, language and licence instead of your field.</span>`
            : html`<input type="text" name="t_titles" value="${t.roles.titles.join(', ')}" placeholder="e.g. Waiter, Barista, Receptionist" style="margin-top:6px">`}</span></label>`)}
      </div></div>
    <details style="margin-top:10px"><summary class="small">Different place or salary for this search (optional)</summary>
      <div class="form-grid" style="margin-top:8px">
        <label class="field">City<input type="text" name="t_city" value="${(t.location && t.location.city) || ''}" placeholder="same as where I live"></label>
        <label class="field">Radius (km)<input type="number" name="t_radius" min="0" max="500" value="${(t.location && t.location.radius_km) || ''}"></label>
        <label class="field">Minimum salary<input type="text" name="t_salary" value="${t.min_salary || ''}" placeholder="e.g. 12 €/h"></label>
      </div></details>
  </div>`;
}

export function bindTargets(root, profile) {
  const redraw = () => { readTargets(root, profile); $('#targets', root).innerHTML = profile.targets.map((t, i) => targetBox(t, i).s).join(''); bindRemove(); };
  const bindRemove = () => $$('[data-remove]', root).forEach((b) => b.addEventListener('click', () => {
    readTargets(root, profile);
    if (profile.targets.length <= 1) return;
    profile.targets.splice(Number(b.dataset.remove), 1);
    $('#targets', root).innerHTML = profile.targets.map((t, i) => targetBox(t, i).s).join('');
    bindRemove();
  }));
  $('#add-target', root).addEventListener('click', () => {
    readTargets(root, profile);
    const n = profile.targets.length + 1;
    let id = `t${n}`;
    while (profile.targets.some((t) => t.id === id)) id = `t${Number(id.slice(1)) + 1}`;
    profile.targets.push({ id, name: '', job_types: ['part_time'], roles: { scope: 'any', titles: [] }, location: null, min_salary: '', active: true });
    redraw();
  });
  bindRemove();
}

export function readTargets(root, profile) {
  $$('[data-target]', root).forEach((box) => {
    const i = Number(box.dataset.target);
    const t = profile.targets[i];
    if (!t) return;
    t.name = $('[name=t_name]', box).value.trim();
    t.active = $('[name=t_active]', box).checked;
    t.job_types = $$('[name=t_types]:checked', box).map((c) => c.value);
    t.roles = { scope: ($(`[name=t_scope_${i}]:checked`, box) || {}).value || 'cv', titles: ($('[name=t_titles]', box).value || '').split(',').map((s) => s.trim()).filter(Boolean) };
    const city = $('[name=t_city]', box).value.trim();
    const radius = Number($('[name=t_radius]', box).value) || null;
    t.location = city || radius ? { city, radius_km: radius } : null;
    t.min_salary = $('[name=t_salary]', box).value.trim();
  });
}

// ---- where I live ------------------------------------------------------------------------------
export function locationSection(p) {
  const l = p.location;
  return html`<div class="form-grid">
      <label class="field">City / town *<input type="text" name="l_city" value="${l.city}" placeholder="e.g. Rimini"></label>
      <label class="field">Country *<input type="text" name="l_country" value="${l.country}" placeholder="e.g. Italy"></label>
      <label class="field">How far can you travel? <span class="hint"><output id="r_out">${l.radius_km}</output> km</span>
        <input type="range" name="l_radius" min="0" max="150" step="5" value="${l.radius_km}"></label>
    </div>
    <div style="margin-top:12px"><b class="small">Remote work</b>
      <div class="row" style="margin-top:6px">${[['no', 'Not remote'], ['also', 'Also remote jobs'], ['only', 'Only remote jobs']].map(([v, label]) => html`<label class="chip" style="cursor:pointer"><input type="radio" name="l_remote" value="${v}" ${l.remote === v ? 'checked' : ''}> ${label}</label>`)}</div></div>
    <div class="row" style="margin-top:12px"><label class="check"><input type="checkbox" name="l_relocate" ${l.relocate ? 'checked' : ''}> I would move for the right job</label>
      <input type="text" name="l_where" value="${l.relocate_where}" placeholder="where? e.g. anywhere in Germany" style="max-width:320px"></div>`.s;
}

export function bindLocation(root) {
  const r = $('[name=l_radius]', root);
  if (r) r.addEventListener('input', () => { $('#r_out', root).textContent = r.value; });
}

export function readLocation(root, p) {
  p.location.city = $('[name=l_city]', root).value.trim();
  p.location.country = $('[name=l_country]', root).value.trim();
  p.location.radius_km = Number($('[name=l_radius]', root).value) || 0;
  p.location.remote = ($('[name=l_remote]:checked', root) || {}).value || 'also';
  p.location.relocate = $('[name=l_relocate]', root).checked;
  p.location.relocate_where = $('[name=l_where]', root).value.trim();
}

// ---- about me -------------------------------------------------------------------------------------
const LEVELS = ['', 'Native', 'C2', 'C1', 'B2', 'B1', 'A2', 'A1', 'Basic', 'Good', 'Fluent'];

export function aboutSection(p) {
  const a = p.about;
  const langs = a.languages.length ? a.languages : [{ name: '', level: '' }];
  return html`<b class="small">Languages</b>
    <div id="langs" style="margin-top:6px">${langs.map((l) => langRow(l))}</div>
    <button class="btn small" type="button" id="add-lang">+ Language</button>
    <div class="form-grid" style="margin-top:14px">
      <label class="field">Work permit <span class="hint">e.g. EU citizen, visa until 2027, need sponsorship</span><input type="text" name="a_permit" value="${a.work_permit}"></label>
      <label class="field">Driving licence <span class="hint">e.g. B, none</span><input type="text" name="a_licence" value="${a.driving_licence}"></label>
      <label class="field">Minimum salary <span class="hint">optional</span><input type="text" name="a_salary" value="${a.min_salary}" placeholder="e.g. 30,000 €/year"></label>
      <label class="field">Can start <span class="hint">optional</span><input type="text" name="a_start" value="${a.start_date}" placeholder="e.g. now, March 2027"></label>
    </div>
    <label class="field" style="margin-top:12px">Things you do NOT want <span class="hint">e.g. night shifts, heavy lifting, call centres</span><input type="text" name="a_avoid" value="${a.avoid}"></label>
    <label class="field" style="margin-top:12px">Anything else the AI should know <span class="hint">optional</span><textarea name="a_notes" rows="3">${a.notes}</textarea></label>`.s;
}

function langRow(l) {
  return html`<div class="lang-row"><input type="text" name="lang_name" value="${l.name}" placeholder="Language">
    <select name="lang_level">${LEVELS.map((v) => html`<option value="${v}" ${v === l.level ? 'selected' : ''}>${v || 'Level'}</option>`)}${l.level && !LEVELS.includes(l.level) ? html`<option selected>${l.level}</option>` : ''}</select>
    <button class="btn small ghost" type="button" data-del-lang aria-label="Remove">✕</button></div>`;
}

export function bindAbout(root) {
  const bindDel = () => $$('[data-del-lang]', root).forEach((b) => { b.onclick = () => b.closest('.lang-row').remove(); });
  $('#add-lang', root).addEventListener('click', () => { $('#langs', root).insertAdjacentHTML('beforeend', langRow({ name: '', level: '' }).s); bindDel(); });
  bindDel();
}

export function readAbout(root, p) {
  p.about.languages = $$('.lang-row', root).map((r) => ({ name: $('[name=lang_name]', r).value.trim(), level: $('[name=lang_level]', r).value })).filter((l) => l.name);
  p.about.work_permit = $('[name=a_permit]', root).value.trim();
  p.about.driving_licence = $('[name=a_licence]', root).value.trim();
  p.about.min_salary = $('[name=a_salary]', root).value.trim();
  p.about.start_date = $('[name=a_start]', root).value.trim();
  p.about.avoid = $('[name=a_avoid]', root).value.trim();
  p.about.notes = $('[name=a_notes]', root).value.trim();
}

// ---- applying -----------------------------------------------------------------------------------------
const MODE_HELP = {
  off: 'The AI makes your CV and letter for each job and gives you the link. You apply yourself.',
  assist: 'The AI opens the application form, fills it in and checks it. You look at it and click Submit.',
  auto: 'The AI applies for you. Before each round it shows you the list of jobs and waits for your OK. It never types passwords or solves "I am not a robot" checks.',
  full_auto: 'The AI works for you while you are away: after every search it applies on its own to the jobs that fit well enough, without asking first. It answers its own questions from your profile and writes down each decision for you. Anything only you can do goes to your "Needs you" list, and the work carries on.',
};

export function applySection(p) {
  const a = p.applying;
  const ans = a.answers;
  return html`<div class="choice-cards">${app.meta.apply_modes.map((m) => html`<label class="choice-card"><input type="radio" name="ap_mode" value="${m.id}" ${a.mode === m.id ? 'checked' : ''}><span><b>${m.label}</b><span class="hint">${MODE_HELP[m.id]}</span></span></label>`)}</div>
    <div class="target" id="full-auto-opts" style="margin-top:12px" ${a.mode === 'full_auto' ? '' : 'hidden'}><b class="small">Fully automatic</b>
      <div class="form-grid" style="margin-top:8px">
        <label class="field">Only apply when the fit is at least <span class="hint"><output id="mf_out">${a.min_fit}</output> %</span>
          <input type="range" name="ap_minfit" min="0" max="100" step="5" value="${a.min_fit}"></label>
        <label class="field">When the AI has a question, wait for me <span class="hint">seconds, then it decides itself</span>
          <input type="number" name="ap_wait" min="0" max="3600" value="${a.proxy_wait_seconds}"></label>
      </div>
      <p class="hint" style="margin-top:8px">Every decision it takes for you is written down; you see them on the Home page and in AI activity.
        Robot checks ("I am not a robot"), logins and questions it cannot answer from your data are never guessed: those jobs go to your <b>Needs you</b> list.</p>
    </div>
    <div class="form-grid" style="margin-top:12px">
      <label class="field">Most applications per day<input type="number" name="ap_cap" min="1" max="100" value="${a.daily_cap}"></label>
      <label class="field">Attach my certificates<select name="ap_attach">
        ${[['country_default', 'As usual in that country'], ['always', 'Always (all marked documents)'], ['never', 'Never, CV and letter only']].map(([v, l]) => html`<option value="${v}" ${a.attachments === v ? 'selected' : ''}>${l}</option>`)}</select></label>
    </div>
    <details style="margin-top:12px"><summary><b class="small">Answers for application forms</b> <span class="hint">used only in forms you allow</span></summary>
      <div class="form-grid" style="margin-top:8px">
        <label class="field">Notice period<input type="text" name="ans_notice" value="${ans.notice_period}" placeholder="e.g. 1 month"></label>
        <label class="field">Salary expectation<input type="text" name="ans_salary" value="${ans.salary_expectation}"></label>
        <label class="field">Availability<input type="text" name="ans_avail" value="${ans.availability}" placeholder="e.g. weekends, from 1 Dec"></label>
        <label class="field">Willing to relocate?<input type="text" name="ans_reloc" value="${ans.relocation}"></label>
      </div>
      <label class="field" style="margin-top:8px">Other standard answers<textarea name="ans_extra" rows="3" placeholder="e.g. How did you hear about us: online job board">${ans.extra}</textarea></label>
    </details>`.s;
}

// Show the fully-automatic options only when that mode is picked.
export function bindApply(root) {
  const opts = $('#full-auto-opts', root);
  $$('[name=ap_mode]', root).forEach((r) => r.addEventListener('change', () => { opts.hidden = r.value !== 'full_auto' || !r.checked; }));
  const mf = $('[name=ap_minfit]', root);
  mf.addEventListener('input', () => { $('#mf_out', root).textContent = mf.value; });
}

export function readApply(root, p) {
  p.applying.mode = ($('[name=ap_mode]:checked', root) || {}).value || 'assist';
  p.applying.daily_cap = Number($('[name=ap_cap]', root).value) || 10;
  p.applying.min_fit = Number($('[name=ap_minfit]', root).value);
  p.applying.proxy_wait_seconds = Number($('[name=ap_wait]', root).value);
  p.applying.attachments = $('[name=ap_attach]', root).value;
  p.applying.answers = {
    notice_period: $('[name=ans_notice]', root).value.trim(),
    salary_expectation: $('[name=ans_salary]', root).value.trim(),
    availability: $('[name=ans_avail]', root).value.trim(),
    relocation: $('[name=ans_reloc]', root).value.trim(),
    extra: $('[name=ans_extra]', root).value.trim(),
  };
}

// ---- contact (person) ---------------------------------------------------------------------------------
export function personSection(p) {
  const s = p.person;
  return html`<div class="form-grid">
    <label class="field">Full name<input type="text" name="p_name" value="${s.name}"></label>
    <label class="field">E-mail<input type="email" name="p_email" value="${s.email}"></label>
    <label class="field">Phone<input type="tel" name="p_phone" value="${s.phone}"></label>
    <label class="field">Address <span class="hint">only used in documents and forms</span><input type="text" name="p_address" value="${s.address}"></label>
    <label class="field">Date of birth <span class="hint">optional, some countries expect it</span><input type="text" name="p_birth" value="${s.birth_date}"></label>
    <label class="field">Nationality <span class="hint">optional</span><input type="text" name="p_nat" value="${s.nationality}"></label>
  </div>
  <label class="field" style="margin-top:12px">Links <span class="hint">LinkedIn, portfolio… one per line</span><textarea name="p_links" rows="2">${(s.links || []).join('\n')}</textarea></label>`.s;
}

export function readPerson(root, p) {
  const v = (n) => $(`[name=${n}]`, root).value.trim();
  Object.assign(p.person, { name: v('p_name'), email: v('p_email'), phone: v('p_phone'), address: v('p_address'), birth_date: v('p_birth'), nationality: v('p_nat'), links: v('p_links').split('\n').map((s) => s.trim()).filter(Boolean) });
}

export function languageSection(p) {
  const opts = ['auto', 'English', 'Italian', 'German', 'French', 'Spanish', 'Portuguese', 'Dutch', 'Polish', 'Arabic', 'Turkish'];
  return html`<div class="form-grid">
    <label class="field">Language of my CV and letters<select name="lg_docs">${opts.map((o) => html`<option value="${o}" ${p.documents_language === o ? 'selected' : ''}>${o === 'auto' ? 'The language of each job ad' : o}</option>`)}</select></label>
    <label class="field">The AI talks to me in<input type="text" name="lg_reply" value="${p.reply_language}" list="lg-list"><datalist id="lg-list">${opts.slice(1).map((o) => html`<option value="${o}">`)}</datalist></label>
  </div>`.s;
}

export function readLanguage(root, p) {
  p.documents_language = $('[name=lg_docs]', root).value;
  p.reply_language = $('[name=lg_reply]', root).value.trim() || 'English';
}

export { raw };
