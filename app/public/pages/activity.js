import { api, html, raw, md, ago, when, $$ } from '../app.js';

let mainEl = null;
let open = null;

const BADGE = { done: 'ok', failed: 'bad', cancelled: '', interrupted: 'warn', running: 'info', queued: '' };

export async function render(main, { query } = {}) {
  mainEl = main;
  if (query && query.run) open = query.run;
  const runs = await api('GET', '/api/runs');
  const detail = open ? await api('GET', `/api/runs/${open}`).catch(() => null) : null;
  const decisions = detail && detail.proxy ? await api('GET', `/api/decisions?run=${encodeURIComponent(detail.id)}`).catch(() => []) : [];
  main.innerHTML = html`<div class="page">
    <div class="page-head"><div class="grow"><h1>AI activity</h1><p class="muted">Everything the AI did for you, step by step.</p></div></div>
    <div class="card">${runs.length ? runs.map((r) => html`<div class="inbox-item" style="cursor:pointer" data-open="${r.id}">
        ${r.status === 'running' ? html`<span class="spinner"></span>` : html`<span class="badge ${BADGE[r.status] || ''}">${r.status}</span>`}
        <div class="body"><b>${r.title}</b>${r.proxy ? html` <span class="badge warn">fully automatic</span>` : ''}<div class="small muted">${r.tool_name || r.tool || ''} · ${ago(r.created_at)}${r.ticket ? ` · ${r.ticket}` : ''}</div></div>
        ${r.status === 'running' || r.status === 'queued' ? html`<button class="btn small" data-cancel="${r.id}">Stop</button>` : ''}
      </div>
      ${detail && detail.id === r.id ? html`<div style="padding:4px 0 14px 46px">
        <p class="small muted">Started ${when(detail.started_at)}${detail.finished_at ? ` · finished ${when(detail.finished_at)}` : ''}</p>
        ${detail.error ? html`<div class="notice bad small">${detail.error}</div>` : ''}
        ${detail.result_text ? html`<div class="md" style="margin:8px 0">${raw(md(detail.result_text))}</div>` : ''}
        ${decisions.length ? html`<h3 style="margin-top:8px">Decisions taken for you</h3><ul class="small">${decisions.map((d) => html`<li>${d.ticket ? html`<a href="#/ticket/${d.ticket}">${d.ticket}</a>: ` : ''}${d.text}</li>`)}</ul>` : ''}
        ${detail.steps.length ? html`<details ${detail.status === 'running' ? 'open' : ''}><summary class="small">${detail.steps.length} steps</summary><ul class="steps">${detail.steps.map((s) => html`<li>${s.text} <span class="muted">${ago(s.at)}</span></li>`)}</ul></details>` : ''}
        ${detail.warnings && detail.warnings.length ? html`<details><summary class="small">Warnings</summary><ul class="small">${detail.warnings.map((w) => html`<li>${w}</li>`)}</ul></details>` : ''}
        <p class="small muted mono" style="margin-top:6px">workspace/runs/${detail.id}/</p>
      </div>` : ''}`) : html`<div class="empty">Nothing yet.</div>`}</div></div>`.s;
  $$('[data-open]', main).forEach((el) => el.addEventListener('click', (e) => {
    if (e.target.closest('[data-cancel]')) return;
    open = open === el.dataset.open ? null : el.dataset.open;
    render(main);
  }));
}

let pending = null;
export function onEvent(name) {
  if (name !== 'run' || !mainEl) return;
  clearTimeout(pending);
  pending = setTimeout(() => render(mainEl), 400);
}

export function leave() {
  open = null;
}
