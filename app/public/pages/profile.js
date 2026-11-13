import { app, api, html, raw, toast, confirmDialog, startRun, hasSkill, refreshState, docUrl, tokenUrl, ago, $, $$ } from '../app.js';
import * as F from './forms.js';

let mainEl = null;
let profile = null;

const PHOTO_MODES = [['auto', 'As usual in the country of the job'], ['always', 'Always'], ['never', 'Never']];

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
    <div class="card"><h2>CV photo and design</h2><div id="cv-look"><p class="muted">Loading…</p></div></div>
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
  renderCvLook();
}

// ---- CV photo and design ------------------------------------------------------------------------------
// The photo is a document of type "photo" (the newest one is used). The design and the photo rule are saved
// in the profile at once, without the Save button, so the next CV the AI makes already uses them.
async function saveCvSetting(patch) {
  const fresh = await api('GET', '/api/profile');
  await api('PUT', '/api/profile', { ...fresh, cv: { ...(fresh.cv || {}), ...patch } });
  await refreshState();
}

async function renderCvLook() {
  const box = mainEl && $('#cv-look', mainEl);
  if (!box) return;
  let info;
  try {
    info = await api('GET', '/api/cv/templates');
  } catch (err) {
    box.innerHTML = html`<p class="muted">${err.message}</p>`.s;
    return;
  }
  const cv = app.state.profile.cv || {};
  const chosen = info.templates.some((t) => t.id === cv.template) ? cv.template : info.default;
  const hasOwn = info.templates.some((t) => t.own);
  const hasCvDoc = app.state.documents.some((d) => d.type === 'cv');
  const thumb = (t) => (t.own
    ? (info.own_preview ? html`<img class="thumb" src="${tokenUrl(`/api/cv/design/preview.png?v=${Date.now()}`)}" alt="">` : html`<div class="thumb none">Your own design</div>`)
    : html`<img class="thumb" src="/assets/cv-templates/${t.id}.png" alt="">`);
  box.innerHTML = html`<div class="cv-look">
    <div class="cv-photo">
      <div class="frame">${info.photo ? html`<img src="${docUrl(info.photo.id)}" alt="Your CV photo">` : 'No photo yet'}</div>
      <div class="row">
        <button class="btn small" id="photo-pick">${info.photo ? 'Change photo' : 'Add a photo'}</button>
        ${info.photo ? html`<button class="btn small ghost danger" id="photo-del">Remove</button>` : ''}
      </div>
      <input type="file" id="photo-file" hidden accept=".jpg,.jpeg,.png,.webp">
      <label class="field">Show my photo on the CV
        <select id="photo-mode">${PHOTO_MODES.map(([v, l]) => html`<option value="${v}" ${(cv.photo || 'auto') === v ? 'selected' : ''}>${l}</option>`)}</select></label>
      <p class="hint">A clear head-and-shoulders picture (JPG or PNG). It is made smaller automatically and sits at the top right of the CV.</p>
    </div>
    <div>
      <p class="hint" style="margin:0 0 8px">Choose how your CV looks. What it says stays the same, and you can change the design at any time.</p>
      <div class="tpl-grid">
        ${info.templates.map((t) => html`<button type="button" class="tpl-card ${t.id === chosen ? 'on' : ''}" data-tpl="${t.id}" aria-pressed="${t.id === chosen ? 'true' : 'false'}" title="${t.description}">
          ${thumb(t)}
          <span class="t-name">${t.name}${t.id === chosen ? html` <span class="badge ok">chosen</span>` : ''}</span>
          <span class="t-for">${t.good_for}</span>
          ${t.ats === 'weak' ? html`<span class="badge warn">not ideal for online forms</span>` : ''}
        </button>`)}
        ${hasOwn ? '' : html`<div class="tpl-card" style="cursor:default">
          <div class="thumb none">The look of your own CV</div>
          <span class="t-name">My own design</span>
          <span class="t-for">The AI looks at the CV you uploaded and copies its design.</span>
          <button class="btn small" id="own-make" ${hasSkill('cv-design') && hasCvDoc ? '' : 'disabled'} title="${hasCvDoc ? '' : 'Upload your CV first'}">Copy the look of my CV</button>
        </div>`}
      </div>
      <div class="row" style="margin-top:10px">
        <button class="btn" id="tpl-preview">Preview with my CV</button>
        ${hasOwn && hasSkill('cv-design') ? html`<button class="btn ghost" id="own-make">Copy the look of my CV again</button>` : ''}
        ${info.has_cv ? '' : html`<span class="hint">There is no CV data yet, so the preview shows a sample person.</span>`}
      </div>
    </div>
  </div>`.s;

  const again = () => renderCvLook();
  const fail = (err) => toast(err.message, true);
  $$('[data-tpl]', box).forEach((b) => b.addEventListener('click', () => saveCvSetting({ template: b.dataset.tpl }).then(again).catch(fail)));
  $('#photo-mode', box).addEventListener('change', (e) => saveCvSetting({ photo: e.target.value }).then(() => toast('Saved')).catch(fail));
  const pick = $('#photo-file', box);
  $('#photo-pick', box).addEventListener('click', () => pick.click());
  pick.addEventListener('change', async () => {
    const f = pick.files[0];
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) return toast('This picture is larger than 25 MB.', true);
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
      const old = app.state.documents.filter((d) => d.type === 'photo');
      await api('POST', '/api/documents', { filename: f.name, data, type: 'photo', title: 'CV photo' });
      for (const d of old) await api('DELETE', `/api/documents/${d.id}`);
      toast('Photo saved');
    } catch (err) {
      toast(err.message, true);
    }
    render(mainEl);
  });
  const del = $('#photo-del', box);
  if (del) {
    del.addEventListener('click', async () => {
      if (!(await confirmDialog('Remove the photo?', 'CVs made from now on have no photo.', 'Remove'))) return;
      for (const d of app.state.documents.filter((x) => x.type === 'photo')) await api('DELETE', `/api/documents/${d.id}`).catch(fail);
      render(mainEl);
    });
  }
  const own = $('#own-make', box);
  if (own) own.addEventListener('click', () => startRun('cv-design'));
  $('#tpl-preview', box).addEventListener('click', async () => {
    // Opened at the click itself: a window opened later, after the answer arrives, would be blocked as a pop-up.
    const w = window.open('about:blank', '_blank');
    try {
      const r = await api('POST', '/api/cv/preview', { template: chosen });
      const url = tokenUrl(`/api/cv/preview/${r.file}?v=${Date.now()}`);
      if (w) w.location = url; else location.href = url;
    } catch (err) {
      if (w) w.close();
      toast(err.message, true);
    }
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
