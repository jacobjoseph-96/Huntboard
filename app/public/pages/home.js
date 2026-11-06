import { app, api, html, raw, md, ago, startRun, hasSkill, statusLabel, refreshState } from '../app.js';

const ICONS = { ask: '?', setup: '☺', interview_prep: '★', debrief: '✎', follow_up: '↻', offer_prep: '€', review_found: '▦', apply_ready: '➤', needs_you: '!', decisions: '✓' };

let mainEl = null;

export async function render(main) {
  mainEl = main;
  const [items] = await Promise.all([api('GET', '/api/inbox'), refreshState()]);
  const s = app.state;
  const name = (s.profile.person.name || '').split(' ')[0];
  const docsOk = s.documents.some((d) => d.type === 'cv');
  const locOk = s.profile.location.city && s.profile.location.country;
  const aiOk = Boolean(s.settings.ai.tool);
  const searchReady = docsOk && locOk && aiOk;
  const recent = [...app.runs.values()].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3);

  main.innerHTML = html`<div class="page">
    <div class="page-head"><div class="grow"><h1>${name ? `Hello ${name}` : 'Welcome to Huntboard'}</h1>
      <p class="muted">Here is what needs your attention.</p></div>
      <a class="btn primary big" href="#/search">Find jobs</a></div>

    ${!searchReady ? html`<div class="card"><h2>Get ready</h2><ol class="steps-list">
      <li class="${aiOk ? 'done' : ''}"><span class="n">1</span><span>Choose the AI tool that does the work</span><span class="spacer"></span>${aiOk ? '' : html`<a class="btn small" href="#/settings?tab=ai">Choose</a>`}</li>
      <li class="${docsOk ? 'done' : ''}"><span class="n">2</span><span>Upload your CV (and degrees, certificates, references)</span><span class="spacer"></span>${docsOk ? '' : html`<a class="btn small" href="#/profile">Upload</a>`}</li>
      <li class="${locOk ? 'done' : ''}"><span class="n">3</span><span>Tell us where you live and what jobs you want</span><span class="spacer"></span>${locOk ? '' : html`<a class="btn small" href="#/settings">Set</a>`}</li>
    </ol></div>` : ''}

    <div class="grid two" style="margin-top:14px">
      <div class="card"><h2>To do</h2>
        ${items.length ? items.map((i) => html`<div class="inbox-item">
            <div class="ico">${ICONS[i.type] || '•'}</div>
            <div class="body"><b>${i.title}</b>${i.text ? html`<div class="muted small">${i.text}</div>` : ''}</div>
            ${action(i)}
          </div>`) : html`<div class="empty">Nothing to do right now. 🎉</div>`}
      </div>
      <div class="stack">
        <div class="card"><h2>Your board</h2>
          <div class="grid stats">${app.meta.statuses.map((st) => html`<a class="stat" href="#/board" style="text-decoration:none;color:inherit">
            <span class="small muted"><span class="st-dot" style="background:var(--st-${st.id})"></span>${statusLabel(st.id)}</span><b>${s.counts[st.id] || 0}</b></a>`)}</div>
        </div>
        <div class="card"><div class="row"><h2 style="margin:0">Recent AI work</h2><span class="spacer"></span><a class="small" href="#/activity">All</a></div>
          ${recent.length ? recent.map((r) => html`<div class="inbox-item"><div class="body"><b>${r.title}</b>
            <div class="small muted">${r.status} · ${ago(r.created_at)}</div>
            ${r.result_text ? html`<div class="small md" style="max-height:80px;overflow:hidden">${raw(md(r.result_text))}</div>` : ''}</div></div>`)
            : html`<p class="muted">The AI has not done anything yet.</p>`}
        </div>
      </div>
    </div>
  </div>`.s;

  main.querySelectorAll('[data-run]').forEach((b) => b.addEventListener('click', () => startRun(b.dataset.run, { ticket: b.dataset.ticket || null })));
}

function action(i) {
  if (i.type === 'ask') return html`<span class="badge warn">Waiting</span>`;
  if (i.type === 'setup') return html`<a class="btn small" href="#/profile">Open</a>`;
  if (i.type === 'review_found') return html`<a class="btn small" href="#/board">Review</a>`;
  if (i.type === 'needs_you') return html`<a class="btn small primary" href="#/ticket/${i.ticket}">Open</a>`;
  if (i.type === 'decisions') return html`<a class="btn small" href="#/activity">See</a>`;
  if (i.skill && hasSkill(i.skill)) return html`<button class="btn small primary" data-run="${i.skill}" data-ticket="${i.ticket || ''}">${i.type === 'debrief' ? 'Debrief' : i.type === 'apply_ready' ? 'Apply' : 'Start'}</button>`;
  if (i.ticket) return html`<a class="btn small" href="#/ticket/${i.ticket}">Open</a>`;
  return '';
}

export function onEvent(name) {
  if ((name === 'tickets' || name === 'asks') && mainEl) render(mainEl);
}
