#!/usr/bin/env node
// Huntboard app server: the local web app (board, tickets, profile, settings, chat) and its API.
// Listens on 127.0.0.1 only. Every API call needs the token from workspace/settings.json; the page gets it
// when it is loaded from this server, other websites cannot read it.
//
//   node app/server.js [--open] [--port 4317]

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const paths = require('../lib/paths');
const { ensureDir, safeJoin } = require('../lib/fsx');
const store = require('../lib/store');
const profileLib = require('../lib/profile');
const documents = require('../lib/documents');
const inbox = require('../lib/inbox');
const asks = require('../lib/ai/ask');
const proxy = require('../lib/proxy');
const prompts = require('../lib/ai/prompts');
const { Runner, detectTools } = require('../lib/ai/runner');
const { findChromium } = require('../lib/browser');
const pkg = require('../package.json');

const argv = process.argv.slice(2);
const OPEN = argv.includes('--open');
const settings = profileLib.loadSettings();
const portArg = argv.includes('--port') ? Number(argv[argv.indexOf('--port') + 1]) : NaN;
const PORT = Number.isInteger(portArg) && portArg > 0 && portArg < 65536 ? portArg : settings.port || 4317;
if (PORT !== settings.port) profileLib.saveSettings({ port: PORT });
const TOKEN = profileLib.loadSettings().token;
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 40 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.eml': 'message/rfc822',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

for (const d of [paths.applications(), paths.asksDir(), paths.profileDir(), paths.documentsDir(), paths.runsDir()]) ensureDir(d);

// ---- live updates (server-sent events) ------------------------------------------------------
const clients = new Set();
function broadcast(event, data = {}) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
const debounced = {};
function soon(event, data, ms = 250) {
  clearTimeout(debounced[event]);
  debounced[event] = setTimeout(() => broadcast(event, data), ms);
}
function watch(dir, event) {
  try {
    fs.watch(dir, { recursive: true }, () => soon(event));
  } catch {
    // Some Linux setups have no recursive watch: fall back to polling.
    setInterval(() => soon(event), 5000);
  }
}
watch(paths.applications(), 'tickets');
watch(paths.asksDir(), 'asks');
watch(paths.profileDir(), 'profile');
watch(paths.documentsDir(), 'profile');
setInterval(() => broadcast('ping', { t: Date.now() }), 25000);

const runner = new Runner();
runner.on('run', (run) => broadcast('run', summary(run)));

// Fully automatic mode: a finished search goes straight on to applying, without asking.
runner.on('done', (run) => {
  if (run.kind !== 'skill' || run.skill !== 'search' || run.status !== 'done') return;
  if (profileLib.loadProfile().applying.mode !== 'full_auto' || !prompts.skillExists('apply')) return;
  if (!store.listTickets({ status: 'to_apply' }).length) return;
  runner.enqueue({ kind: 'skill', skill: 'apply', proxy: true, title: 'Apply automatically to the new jobs' });
});

function summary(run) {
  return {
    id: run.id, kind: run.kind, skill: run.skill, title: run.title, proxy: Boolean(run.proxy), message: run.kind === 'chat' ? run.message : undefined, ticket: run.ticket, status: run.status, tool: run.tool,
    tool_name: run.tool_name, created_at: run.created_at, started_at: run.started_at, finished_at: run.finished_at,
    steps: run.steps.slice(-8), step_count: run.steps.length, error: run.error, error_kind: run.error_kind,
    result_text: run.status === 'running' ? '' : run.result_text, warnings: (run.warnings || []).slice(-3), denied: run.denied,
  };
}

// ---- helpers ------------------------------------------------------------------------------------
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': typeof body === 'string' || Buffer.isBuffer(body) ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    ...headers,
  });
  res.end(data);
}

function sendFile(res, file, { download = false, name } = {}) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(404, 'File not found');
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'content-type': TYPES[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; frame-ancestors 'self'",
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(name || path.basename(file))}"`,
  });
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'The upload is too large (max 25 MB per file).'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function publicSettings() {
  const s = profileLib.loadSettings();
  const copy = JSON.parse(JSON.stringify(s));
  delete copy.token;
  return copy;
}

function ticketView(t) {
  return { ...store.publicTicket(t), age_days: Math.floor((Date.now() - Date.parse(t.created_at)) / 86400000) };
}

function availableSkills() {
  const dir = path.join(paths.ROOT, 'agent', 'skills');
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((s) => prompts.skillExists(s)) : [];
}

function maybeAutoPrepare(t) {
  const s = profileLib.loadSettings();
  if (s.ai.auto_prepare_interviews && s.ai.tool && prompts.skillExists('interview-prep')) {
    runner.enqueue({ kind: 'skill', skill: 'interview-prep', ticket: t.key });
  }
}

// ---- API --------------------------------------------------------------------------------------------
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), handler });

route('GET', '/api/meta', () => ({
  version: pkg.version,
  statuses: store.STATUSES.map((s) => ({ id: s, label: store.STATUS_LABELS[s] })),
  resolutions: store.RESOLUTIONS,
  stages: store.INTERVIEW_STAGES.map(([id, label]) => ({ id, label })),
  job_types: profileLib.JOB_TYPES.map(([id, label]) => ({ id, label })),
  role_scopes: profileLib.ROLE_SCOPES.map(([id, label]) => ({ id, label })),
  apply_modes: profileLib.APPLY_MODES.map(([id, label]) => ({ id, label })),
  doc_types: documents.DOC_TYPES.map(([id, label, sensitive]) => ({ id, label, sensitive })),
  skills: availableSkills(),
  tasks: prompts.TASKS,
}));

route('GET', '/api/state', () => {
  const profile = profileLib.loadProfile();
  const docs = documents.list();
  const tickets = store.listTickets();
  const counts = Object.fromEntries(store.STATUSES.map((s) => [s, tickets.filter((t) => t.status === s).length]));
  return { profile, settings: publicSettings(), documents: docs, counts, missing: profileLib.missing(profile, docs), busy: runner.busy(), asks: asks.listPending() };
});

route('GET', '/api/tickets', () => store.listTickets().map(ticketView));
route('POST', '/api/tickets', async (req) => {
  const body = await readBody(req);
  const res = store.addTickets([body], { by: 'user', status: store.STATUSES.includes(body.status) ? body.status : 'to_apply' });
  if (res.duplicates.length) throw new HttpError(409, `This job is already on the board as ${res.duplicates[0].key}.`);
  if (!res.added.length) throw new HttpError(400, 'A job needs at least a title.');
  return ticketView(res.added[0]);
});
route('GET', '/api/tickets/:key', (req, p) => {
  const t = store.getTicket(p.key);
  if (!t) throw new HttpError(404, `No ticket ${p.key}`);
  // dir: so the page can show full, copyable file paths (to attach a file to a form or an e-mail by hand).
  return { ticket: ticketView(t), posting: store.readPosting(t.key), files: store.listFiles(t.key), dir: path.resolve(t._dir) };
});
route('PATCH', '/api/tickets/:key', async (req, p) => ticketView(store.setFields(p.key, await readBody(req), { by: 'user' })));
route('POST', '/api/tickets/:key/move', async (req, p) => {
  const b = await readBody(req);
  if (b.status === 'interview' && b.interview) {
    const t = store.addInterviewRound(p.key, b.interview, { by: 'user' });
    maybeAutoPrepare(t);
    return ticketView(t);
  }
  return ticketView(store.moveTicket(p.key, b.status, { by: 'user', resolution: b.resolution, note: b.note }));
});
// Delete a ticket: its folder goes to workspace/trash/ (restorable) and a search will not bring the job back.
route('DELETE', '/api/tickets/:key', async (req, p) => {
  const b = await readBody(req);
  const t = store.getTicket(p.key);
  if (!t) throw new HttpError(404, `No ticket ${p.key}`);
  if (runner.current && runner.current.run.ticket === t.key) throw new HttpError(409, `An AI task is working on ${t.key}; stop it first.`);
  const rec = store.deleteTicket(t.key, { by: 'user', note: b.note || '' });
  soon('tickets');
  return { deleted: rec };
});
route('GET', '/api/deleted', () => store.listDeleted());
route('POST', '/api/tickets/:key/restore', async (req, p) => {
  const t = store.restoreTicket(p.key, { by: 'user' });
  soon('tickets');
  return ticketView(t);
});
const fetched = (r, from) => ({ ticket: ticketView(r.ticket), saved: r.saved, filled: r.filled, from });
// Fetch the job ad for a ticket (LinkedIn guest page, Arbeitsagentur API, the page's schema.org JobPosting). Saves
// it as the Job ad (replacing a saved one only when asked) and fills the empty detail fields.
route('POST', '/api/tickets/:key/fetch-ad', async (req, p) => {
  const b = await readBody(req);
  const t = store.mustGet(p.key);
  if (!/^https?:\/\//i.test(t.link || '')) throw new HttpError(409, 'This ticket has no link to fetch the ad from. Paste the ad text instead.');
  const li = t.link.match(/linkedin\.com\/(?:jobs\/view|comm\/jobs\/view)\/(?:[^/?]*-)?(\d{6,})/i);
  const ba = t.link.match(/arbeitsagentur\.de\/jobsuche\/jobdetail\/([\w-]+)/i);
  const row = li ? { source: 'LinkedIn', native_id: li[1], url: t.link } : ba ? { source: 'Arbeitsagentur', native_id: ba[1], url: t.link } : { source: t.source, url: t.link };
  const res = await require('../lib/adtext').read(row);
  if (!res.ok || !res.text) {
    const why = { rate_limited: 'LinkedIn is limiting requests right now (HTTP 429). Try again in a while, or paste the ad text.',
      ad_gone: 'The ad is gone (404/410): it was taken down.', no_link: 'This ticket has no link to fetch the ad from.' }[res.reason]
      || `Could not read the ad (${res.reason || res.method}${res.error ? ': ' + res.error : ''}). Paste the ad text instead.`;
    throw new HttpError(res.reason === 'rate_limited' ? 429 : 409, why);
  }
  const from = { linkedin: 'LinkedIn', 'ba-api': 'the Arbeitsagentur', jobposting: 'the ad page', http: 'the ad page', api: 'the search' }[res.method] || 'the ad page';
  return fetched(store.fillFromAd(t.key, { text: res.text, extra: res.extra || {}, from: `from ${from}`, replace: Boolean(b.replace), by: 'user' }), from);
});
route('PUT', '/api/tickets/:key/instructions', async (req, p) => {
  const b = await readBody(req);
  const t = store.setInstructions(p.key, b.text, { by: 'user' });
  // "Tell the AI" on a Needs-you banner, then "try again": the user answered it, so it is no longer theirs to do.
  if (b.clear_needs && t.needs) return ticketView(store.setNeeds(p.key, null, { by: 'user' }));
  soon('tickets');
  return ticketView(t);
});
// Show a ticket file in the file manager, selected.
route('POST', '/api/reveal', async (req) => {
  const b = await readBody(req);
  const file = b.key ? safeJoin(store.mustGet(String(b.key))._dir, String(b.path || '')) : null;
  if (!file || !fs.existsSync(file)) throw new HttpError(404, 'That file is not there any more.');
  const { spawn } = require('child_process');
  const [cmd, args] = process.platform === 'win32' ? ['explorer.exe', [`/select,"${path.resolve(file)}"`]]
    : process.platform === 'darwin' ? ['open', ['-R', file]] : ['xdg-open', [path.dirname(file)]];
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsVerbatimArguments: process.platform === 'win32' }).unref();
  return { ok: true, path: path.resolve(file) };
});
route('POST', '/api/tickets/:key/notes', async (req, p) => ticketView(store.addNote(p.key, (await readBody(req)).text, { by: 'user' })));
route('POST', '/api/tickets/:key/rounds', async (req, p) => {
  const t = store.addInterviewRound(p.key, await readBody(req), { by: 'user' });
  maybeAutoPrepare(t);
  return ticketView(t);
});
route('PATCH', '/api/tickets/:key/rounds/:n', async (req, p) => ticketView(store.updateRound(p.key, Number(p.n), await readBody(req), { by: 'user' })));
route('PUT', '/api/tickets/:key/posting', async (req, p) => ticketView(store.writePosting(p.key, (await readBody(req)).text || '', { by: 'user' })));
route('GET', '/api/tickets/:key/file', (req, p, url, res) => {
  const t = store.getTicket(p.key);
  if (!t) throw new HttpError(404, 'No such ticket');
  sendFile(res, safeJoin(t._dir, url.searchParams.get('path')), { download: url.searchParams.has('download') });
});

route('GET', '/api/profile', () => profileLib.loadProfile());
route('PUT', '/api/profile', async (req) => profileLib.saveProfile(await readBody(req)));
route('GET', '/api/settings', () => publicSettings());
route('PUT', '/api/settings', async (req) => {
  const b = await readBody(req);
  delete b.token;
  delete b.port;
  profileLib.saveSettings(b);
  return publicSettings();
});

route('GET', '/api/documents', () => documents.list());
route('POST', '/api/documents', async (req) => {
  const b = await readBody(req);
  if (!b.data || !b.filename) throw new HttpError(400, 'Choose a file to upload.');
  const data = Buffer.from(String(b.data).replace(/^data:[^,]*,/, ''), 'base64');
  const doc = await documents.add({ type: b.type, title: b.title, filename: b.filename, data, issuer: b.issuer, date: b.date, language: b.language });
  soon('profile');
  return doc;
});
route('PATCH', '/api/documents/:id', async (req, p) => documents.update(p.id, await readBody(req)));
route('DELETE', '/api/documents/:id', (req, p) => ({ removed: documents.remove(p.id) }));
route('GET', '/api/documents/:id/file', (req, p, url, res) => {
  const d = documents.get(p.id);
  if (!d) throw new HttpError(404, 'No such document');
  sendFile(res, documents.absPath(d), { name: d.original_name });
});
route('GET', '/api/documents/:id/text', (req, p) => ({ text: documents.readText(p.id) }));

route('GET', '/api/inbox', () => inbox.compute().map((i) => {
  const copy = { ...i };
  delete copy._dir;
  return copy;
}));

route('GET', '/api/ai/tools', () => ({ tools: detectTools(), chosen: profileLib.loadSettings().ai.tool }));
route('POST', '/api/ai/test', () => summary(runner.enqueue({ kind: 'test' })));

route('GET', '/api/runs', () => runner.list(40).map(summary));
route('GET', '/api/runs/:id', (req, p) => {
  const r = runner.get(p.id);
  if (!r) throw new HttpError(404, 'No such run');
  return r;
});
route('POST', '/api/runs', async (req) => {
  const b = await readBody(req);
  return summary(runner.enqueue({ kind: 'skill', skill: String(b.skill || ''), ticket: b.ticket || null, target: b.target || null, message: b.message || '', args: b.args || null }));
});
route('POST', '/api/runs/:id/cancel', (req, p) => ({ cancelled: runner.cancel(p.id) }));
route('POST', '/api/chat', async (req) => {
  const b = await readBody(req);
  if (!String(b.message || '').trim()) throw new HttpError(400, 'Type a message first.');
  return summary(runner.enqueue({ kind: 'chat', message: b.message, context: b.context || null }));
});
route('POST', '/api/chat/reset', () => {
  runner.resetChat();
  return { ok: true };
});

route('GET', '/api/asks', () => asks.listPending());
route('POST', '/api/asks', async (req) => {
  const b = await readBody(req);
  const a = asks.create(b);
  broadcast('asks', { id: a.id });
  return a;
});
route('GET', '/api/asks/:id', (req, p) => {
  const a = asks.get(p.id);
  if (!a) throw new HttpError(404, 'No such question');
  return a;
});
route('POST', '/api/asks/:id/answer', async (req, p) => {
  const a = asks.answer(p.id, (await readBody(req)).answer);
  broadcast('asks', { id: a.id });
  return a;
});

route('POST', '/api/asks/:id/auto', (req, p) => {
  const a = asks.cancel(p.id, 'auto');
  broadcast('asks', { id: p.id });
  return a || {};
});
route('GET', '/api/decisions', (req, p, url) => proxy.listDecisions({ since: url.searchParams.get('since'), run_id: url.searchParams.get('run') }));
route('PUT', '/api/tickets/:key/needs', async (req, p) => {
  const b = await readBody(req);
  return ticketView(store.setNeeds(p.key, b.text ? b.text : null, { by: 'user' }));
});

route('GET', '/api/plan', () => require('../lib/plan').loadAll().targets);
route('GET', '/api/boards', () => require('../lib/boards').load().map((b) => ({ id: b.id, name: b.name, url: b.url, kind: b.access.kind, verified: b.verified })));
route('PUT', '/api/plan/:target/boards/:board', async (req, p) => require('../lib/plan').toggleBoard(p.target, p.board, (await readBody(req)).enabled));

route('GET', '/api/export.xlsx', async (req, p, url, res) => {
  const file = path.join(paths.ws('tmp'), 'huntboard_export.xlsx');
  ensureDir(path.dirname(file));
  await require('../lib/excel').exportXlsx(file);
  sendFile(res, file, { download: true, name: `huntboard_${new Date().toISOString().slice(0, 10)}.xlsx` });
});

// ---- server -------------------------------------------------------------------------------------------
function hostOk(req) {
  const h = String(req.headers.host || '').toLowerCase();
  return h === `127.0.0.1:${PORT}` || h === `localhost:${PORT}`;
}

function tokenOk(req, url) {
  return req.headers['x-huntboard-token'] === TOKEN || url.searchParams.get('token') === TOKEN;
}

function serveStatic(res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '/index.html') {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8').replace('{{TOKEN}}', TOKEN).replace(/{{VERSION}}/g, pkg.version);
    res.writeHead(200, {
      'content-type': TYPES['.html'],
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'self'; connect-src 'self'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
    });
    return res.end(html);
  }
  let file;
  if (rel === '/vendor/marked.js') file = path.join(paths.ROOT, 'node_modules', 'marked', 'lib', 'marked.umd.js');
  else if (rel.startsWith('/assets/')) file = safeJoin(path.join(paths.ROOT, 'assets'), rel.slice('/assets/'.length));
  else file = safeJoin(PUBLIC, rel.slice(1));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (!hostOk(req)) return send(res, 403, 'Forbidden');
    if (!url.pathname.startsWith('/api/')) return serveStatic(res, url);
    if (!tokenOk(req, url)) return send(res, 401, { error: 'Missing or wrong token' });
    if (url.pathname === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('event: hello\ndata: {}\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return undefined;
    }
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(Object.entries(m.groups || {}).map(([k, v]) => [k, decodeURIComponent(v)]));
      const out = await r.handler(req, params, url, res);
      if (out !== undefined && !res.headersSent) send(res, 200, out);
      return undefined;
    }
    return send(res, 404, { error: 'Unknown API route' });
  } catch (err) {
    const status = err.status || (/^No (ticket|document)/.test(err.message) ? 404 : 400);
    if (status >= 500 || !err.status) console.error(err.stack || err);
    if (!res.headersSent) send(res, status, { error: err.message });
    return undefined;
  }
});

function openWindow(url) {
  const browser = findChromium();
  if (browser) {
    const profile = paths.ws('app-window');
    ensureDir(profile);
    spawn(browser, [`--app=${url}`, `--user-data-dir=${profile}`, '--window-size=1440,920', '--no-first-run', '--no-default-browser-check'], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(opener[0], opener[1], { detached: true, stdio: 'ignore' }).unref();
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Huntboard is already running on port ${PORT}.`);
    if (OPEN) openWindow(`http://127.0.0.1:${PORT}/`);
    setTimeout(() => process.exit(0), 500);
    return;
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`Huntboard ${pkg.version} is running: ${url}`);
  console.log('Keep this window open while you use Huntboard. Close it to stop the app.');
  if (OPEN) openWindow(url);
});

module.exports = { server };
