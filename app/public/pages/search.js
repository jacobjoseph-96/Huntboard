import { app, api, html, raw, md, toast, startRun, hasSkill, refreshState, ago, $$ } from '../app.js';

let mainEl = null;

const TYPE = (id) => (app.meta.job_types.find((j) => j.id === id) || { label: id }).label;
const SCOPE = { cv: 'jobs in my field', any: 'any job', custom: 'my chosen roles' };

export async function render(main) {
  mainEl = main;
  const [, plans, boards] = await Promise.all([refreshState(), api('GET', '/api/plan'), api('GET', '/api/boards')]);
  const boardName = (id) => (boards.find((b) => b.id === id) || { name: id }).name;
  const s = app.state;
  const ready = s.missing.length === 0 && s.settings.ai.tool;
  const canSearch = hasSkill('search');
  const canPlan = hasSkill('plan-search');
  const runs = [...app.runs.values()].filter((r) => ['search', 'plan-search'].includes(r.skill)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

  main.innerHTML = html`<div class="page">
    <div class="page-head"><div class="grow"><h1>Find jobs</h1>
      <p class="muted">The AI picks the right job boards for your CV, job type and area, searches them, checks every ad and puts the good ones on your board under "Found".</p></div>
      <button class="btn primary big" data-search="" ${ready && canSearch ? '' : 'disabled'}>Find jobs for all searches</button></div>
    ${!ready ? html`<div class="notice warn">Before searching: ${s.missing.map((m) => ({ cv: 'upload your CV', location: 'set where you live', targets: 'add a search' }[m])).join(', ')}${s.settings.ai.tool ? '' : `${s.missing.length ? ', ' : ''}choose your AI tool`}. <a href="#/settings">Open settings</a></div>` : ''}
    ${s.profile.applying.mode === 'full_auto' ? html`<div class="notice warn" style="margin-bottom:10px"><b>Fully automatic is on.</b> After each search the AI applies on its own to jobs with at least ${s.profile.applying.min_fit}% fit (max ${s.profile.applying.daily_cap} a day). <a href="#/settings?tab=apply">Change</a></div>` : ''}
    ${!canSearch ? html`<div class="notice" style="margin-top:10px">Searching job boards arrives in the next version of Huntboard. You can already add jobs yourself on the Board and let the AI read your CV.</div>` : ''}

    <div class="grid two" style="margin-top:14px">${s.profile.targets.map((t) => html`<div class="card">
      <div class="row"><h2 style="margin:0">${t.name}</h2>${t.active ? '' : html`<span class="badge">off</span>`}</div>
      <p class="muted small" style="margin-top:4px">${t.job_types.map(TYPE).join(' / ')} · ${SCOPE[t.roles.scope]}${t.roles.titles.length ? `: ${t.roles.titles.join(', ')}` : ''}
        · ${(t.location && t.location.city) || s.profile.location.city || '?'} + ${(t.location && t.location.radius_km) || s.profile.location.radius_km} km${s.profile.location.remote !== 'no' ? ' · remote too' : ''}</p>
      ${plans[t.id] ? html`<div class="small" style="margin-top:8px"><b>Job boards</b> <span class="hint">click to switch on/off</span>
          <div class="row" style="margin-top:4px;gap:6px">${plans[t.id].boards.map((b) => html`<button class="chip ${b.enabled ? 'on' : ''}" data-toggle="${t.id}|${b.id}|${b.enabled ? 'off' : 'on'}" title="${b.why || ''}">${boardName(b.id)}</button>`)}</div>
          <div class="muted" style="margin-top:6px"><b>Search words:</b> ${plans[t.id].queries.join(' · ')}</div></div>`
        : html`<p class="small muted" style="margin-top:8px">No job boards chosen yet: press <b>Choose job boards</b> (the first search does it too).</p>`}
      <div class="row" style="margin-top:10px">
        <button class="btn primary" data-search="${t.id}" ${ready && canSearch && t.active ? '' : 'disabled'}>Find jobs</button>
        <button class="btn" data-plan="${t.id}" ${ready && canPlan ? '' : 'disabled'}>Choose job boards</button>
        <a class="btn ghost" href="#/settings?tab=search">Edit</a>
      </div></div>`)}</div>

    <div class="card" style="margin-top:14px"><h2>Recent searches</h2>
      ${runs.length ? runs.map((r) => html`<div class="inbox-item"><div class="body"><b>${r.title}</b> <span class="small muted">${r.status} · ${ago(r.created_at)}</span>
          ${r.status === 'running' ? html`<ul class="steps">${(r.steps || []).slice(-5).map((x) => html`<li>${x.text}</li>`)}</ul>` : ''}
          ${r.result_text ? html`<div class="md small">${raw(md(r.result_text))}</div>` : ''}${r.error ? html`<div class="small" style="color:var(--danger)">${r.error}</div>` : ''}</div></div>`)
        : html`<p class="muted">No searches yet.</p>`}
    </div></div>`.s;

  $$('[data-search]', main).forEach((b) => b.addEventListener('click', async () => { await startRun('search', { target: b.dataset.search || null }); render(main); }));
  $$('[data-toggle]', main).forEach((b) => b.addEventListener('click', async () => {
    const [tid, bid, state] = b.dataset.toggle.split('|');
    await api('PUT', `/api/plan/${tid}/boards/${bid}`, { enabled: state === 'on' }).catch((err) => toast(err.message, true));
    render(main);
  }));
  $$('[data-plan]', main).forEach((b) => b.addEventListener('click', async () => { await startRun('plan-search', { target: b.dataset.plan }); render(main); }));
}

export function onEvent(name, data) {
  if (name === 'run' && mainEl && data && ['search', 'plan-search'].includes(data.skill)) render(mainEl);
}
