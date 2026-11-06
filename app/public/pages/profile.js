import { app, api, html, raw, toast, confirmDialog, startRun, hasSkill, refreshState, docUrl, ago, $, $$ } from '../app.js';
import * as F from './forms.js';

let mainEl = null;
let profile = null;

export async function render(main) {
  mainEl = main;
  await refreshState();
  profile = JSON.parse(JSON.stringify(app.state.profile));
  main.innerHTML = html`<div class="page">
    <div class="page-head"><div class="grow"><h1>Profile &amp; documents</h1>
      <p class="muted">Everything here stays on this computer. The AI uses it to find jobs, write documents and fill in forms.</p></div></div>
    <div class="card">
      <div class="row"><h2 style="margin:0">Your documents</h2><span class="spacer"></span>
        <button class="btn primary" id="ai-read" ${hasSkill('setup') ? '' : 'disabled'}>Let the AI read my CV and fill in my profile</button></div>
      ${raw(documentsBlock())}
    </div>
    <div class="card"><h2>Contact details</h2>${F.raw(F.personSection(profile))}</div>
    <div class="card"><h2>About you</h2>${F.raw(F.aboutSection(profile))}
      ${profile.suggested_roles.length ? html`<h3 style="margin-top:14px">Jobs that fit your CV <span class="hint">(suggested by the AI)</span></h3>
        <div class="row">${profile.suggested_roles.map((r) => html`<span class="chip">${r}</span>`)}</div>` : ''}</div>
    <div class="row end" style="margin-top:14px"><button class="btn primary big" id="save">Save profile</button></div>
  </div>`.s;
  bindDocuments(main, () => render(main));
  F.bindAbout(main);
  $('#save', main).addEventListener('click', save);
  $('#ai-read', main).addEventListener('click', async () => {
    if (!app.state.documents.some((d) => d.type === 'cv')) return toast('Upload your CV first.', true);
    await save(true);
    startRun('setup');
  });
}

async function save(quiet) {
  F.readPerson(mainEl, profile);
  F.readAbout(mainEl, profile);
  try {
    const fresh = await api('GET', '/api/profile');
    // Only the sections on this page are taken from the form.
    const merged = { ...fresh, person: profile.person, about: profile.about };
    profile = await api('PUT', '/api/profile', merged);
    await refreshState();
    if (quiet !== true) toast('Profile saved');
  } catch (err) {
    toast(err.message, true);
  }
}

export function documentsBlock() {
  const docs = app.state.documents;
  const types = app.meta.doc_types;
  return html`<div class="dropzone" id="drop" tabindex="0" role="button" style="margin-top:12px">
      <b>Drop files here</b> or click to choose · PDF, Word, text or images · max 25 MB
      <div class="row" id="doc-type-row" style="justify-content:center;margin-top:8px">
        <label class="small">This is my <select id="doc-type">${types.map((t) => html`<option value="${t.id}" ${!docs.some((d) => d.type === 'cv') && t.id === 'cv' ? 'selected' : ''}>${t.label}</option>`)}</select></label>
      </div>
      <input type="file" id="file" multiple hidden accept=".pdf,.doc,.docx,.txt,.md,.rtf,.jpg,.jpeg,.png,.webp,.heic">
    </div>
    <p class="hint" style="margin-top:8px">Add your CV and anything that proves it: degrees, transcripts, certificates, language certificates, references from employers, recommendation letters, portfolio. Documents marked <b>sensitive</b> (ID, permit, licence) are never sent with applications unless you say so.</p>
    <div id="doc-list">${docs.length ? docs.map((d) => html`<div class="doc-row">
      <div><b>${d.title}</b> <span class="badge">${(types.find((t) => t.id === d.type) || {}).label || d.type}</span>
        ${d.text_status === 'ok' ? html`<span class="badge ok">readable</span>` : d.text_status === 'image' ? html`<span class="badge warn">picture</span>` : d.text_status === 'needs_review' ? html`<span class="badge warn">scan: check it</span>` : html`<span class="badge bad">${d.text_status}</span>`}
        ${d.sensitive ? html`<span class="badge bad">sensitive</span>` : ''}
        <div class="small muted">${d.original_name} · ${Math.round(d.size / 1024)} KB · added ${ago(d.added_at)}</div>
        <div class="row small" style="margin-top:6px">
          <label class="check"><input type="checkbox" data-attach="${d.id}" ${d.attach ? 'checked' : ''}> send with applications</label>
          <label class="check"><input type="checkbox" data-sensitive="${d.id}" ${d.sensitive ? 'checked' : ''}> sensitive</label>
          <input type="text" data-issuer="${d.id}" value="${d.issuer}" placeholder="issued by" style="width:160px">
          <input type="text" data-date="${d.id}" value="${d.date}" placeholder="date" style="width:110px">
        </div></div>
      <div class="row"><a class="btn small" href="${docUrl(d.id)}" target="_blank" rel="noopener">Open</a><button class="btn small ghost danger" data-del="${d.id}">Remove</button></div>
    </div>`) : html`<div class="empty">No documents yet.</div>`}</div>`.s;
}

export function bindDocuments(root, rerender) {
  const drop = $('#drop', root);
  const input = $('#file', root);
  if (!drop) return;
  drop.addEventListener('click', (e) => { if (!e.target.closest('#doc-type-row')) input.click(); });
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload([...e.dataTransfer.files]); });
  input.addEventListener('change', () => upload([...input.files]));
  async function upload(files) {
    const type = $('#doc-type', root).value;
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name} is larger than 25 MB.`, true); continue; }
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      try {
        await api('POST', '/api/documents', { filename: f.name, data, type, title: f.name.replace(/\.[^.]+$/, '') });
        toast(`${f.name} added`);
      } catch (err) {
        toast(`${f.name}: ${err.message}`, true);
      }
    }
    await refreshState();
    rerender();
  }
  const patch = (id, body) => api('PATCH', `/api/documents/${id}`, body).then(refreshState).catch((err) => toast(err.message, true));
  $$('[data-attach]', root).forEach((c) => c.addEventListener('change', () => patch(c.dataset.attach, { attach: c.checked })));
  $$('[data-sensitive]', root).forEach((c) => c.addEventListener('change', () => patch(c.dataset.sensitive, { sensitive: c.checked })));
  $$('[data-issuer]', root).forEach((c) => c.addEventListener('change', () => patch(c.dataset.issuer, { issuer: c.value })));
  $$('[data-date]', root).forEach((c) => c.addEventListener('change', () => patch(c.dataset.date, { date: c.value })));
  $$('[data-del]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('Remove document?', 'The file is moved to workspace/documents/.removed.', 'Remove'))) return;
    await api('DELETE', `/api/documents/${b.dataset.del}`).catch((err) => toast(err.message, true));
    await refreshState();
    rerender();
  }));
}

export function onEvent(name) {
  // Re-render after the AI filled in the profile, unless the user is typing.
  if (name === 'profile' && mainEl && !mainEl.contains(document.activeElement)) render(mainEl);
}
