// Starts the real app server on a free port and checks security, the API and the hunt-ask round trip.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { freshWorkspace, ROOT } = require('./helpers');

freshWorkspace('app');
const profileLib = require('../lib/profile');

let server;
let port;
let token;

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

function req(method, route, { body, headers = {}, host } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request({ host: '127.0.0.1', port, path: route, method, headers: { host: host || `127.0.0.1:${port}`, 'x-huntboard-token': token, 'content-type': 'application/json', ...headers } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(buf); } catch { json = buf; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

test.before(async () => {
  port = await freePort();
  profileLib.saveSettings({ port });
  token = profileLib.loadSettings().token;
  server = spawn(process.execPath, [path.join(ROOT, 'app', 'server.js'), '--port', String(port)], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    server.stdout.on('data', (d) => { if (/running/.test(String(d))) resolve(); });
    server.on('exit', (c) => reject(new Error(`server exited ${c}`)));
  });
});

test.after(() => server && server.kill());

test('rejects requests without the token or from another host', async () => {
  assert.strictEqual((await req('GET', '/api/state', { headers: { 'x-huntboard-token': 'wrong' } })).status, 401);
  assert.strictEqual((await req('GET', '/api/state', { host: 'evil.example:80' })).status, 403);
  const page = await req('GET', '/', {});
  assert.strictEqual(page.status, 200);
  assert.match(page.body, new RegExp(token));
});

test('tickets through the API', async () => {
  const created = await req('POST', '/api/tickets', { body: { title: 'Barista', company: 'Bar Uno', link: 'https://example.com/job/1' } });
  assert.strictEqual(created.status, 200);
  assert.strictEqual(created.body.status, 'to_apply');
  const dup = await req('POST', '/api/tickets', { body: { title: 'Barista', company: 'Bar Uno', link: 'https://example.com/job/1' } });
  assert.strictEqual(dup.status, 409);
  const moved = await req('POST', `/api/tickets/${created.body.key}/move`, { body: { status: 'interview', interview: { stage: 'trial_shift', at: '2099-05-01T09:00:00Z' } } });
  assert.strictEqual(moved.body.interview.rounds[0].stage, 'trial_shift');
  const inbox = await req('GET', '/api/inbox');
  assert.ok(inbox.body.some((i) => i.type === 'interview_prep'));
  const file = await req('GET', `/api/tickets/${created.body.key}/file?path=../../settings.json`);
  assert.strictEqual(file.status, 404);
});

test('hunt ask waits for the answer given in the app', async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'hunt.js'), 'ask', 'Apply to these 3 jobs?', '--choices', 'Yes,No'], { env: process.env });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  let pending = [];
  for (let i = 0; i < 40 && !pending.length; i++) {
    await new Promise((r) => setTimeout(r, 150));
    pending = (await req('GET', '/api/asks')).body;
  }
  assert.strictEqual(pending.length, 1);
  assert.deepStrictEqual(pending[0].choices, ['Yes', 'No']);
  await req('POST', `/api/asks/${pending[0].id}/answer`, { body: { answer: 'Yes' } });
  const code = await new Promise((r) => child.on('exit', r));
  assert.strictEqual(code, 0);
  assert.match(out, /ANSWER: Yes/);
});

test('fully automatic: a question waits briefly, then the AI is told to decide itself', async () => {
  const p = profileLib.loadProfile();
  p.applying.mode = 'full_auto';
  p.applying.proxy_wait_seconds = 1;
  profileLib.saveProfile(p);
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'hunt.js'), 'ask', 'Which CV language?', '--choices', 'Italian,English'], { env: { ...process.env, HUNTBOARD_PROXY: '1', HUNTBOARD_RUN_ID: 'run-test-proxy' } });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  const code = await new Promise((r) => child.on('exit', r));
  assert.strictEqual(code, 0);
  assert.match(out, /Decide for them as their stand-in/);
  assert.strictEqual((await req('GET', '/api/asks')).body.length, 0);

  const t = (await req('POST', '/api/tickets', { body: { title: 'Waiter', company: 'Hotel Tre' } })).body;
  const hunt = (...a) => spawn(process.execPath, [path.join(ROOT, 'tools', 'hunt.js'), ...a], { env: { ...process.env, HUNTBOARD_PROXY: '1', HUNTBOARD_RUN_ID: 'run-test-proxy' } });
  await new Promise((r) => hunt('decide', 'Chose the Italian CV because the ad is in Italian', '--ticket', t.key).on('exit', r));
  await new Promise((r) => hunt('needs', t.key, 'Robot check on the application page').on('exit', r));
  const decisions = (await req('GET', '/api/decisions?run=run-test-proxy')).body;
  assert.deepStrictEqual(decisions.map((d) => d.text), ['Chose the Italian CV because the ad is in Italian', 'Left for you: Robot check on the application page']);
  const inbox = (await req('GET', '/api/inbox')).body;
  assert.ok(inbox.some((i) => i.type === 'needs_you' && i.ticket === t.key));
  assert.ok(inbox.some((i) => i.type === 'decisions' && i.count === 2));
  const cleared = (await req('PUT', `/api/tickets/${t.key}/needs`, { body: { text: null } })).body;
  assert.strictEqual(cleared.needs, null);
});

test('skills that do not exist yet are refused politely', async () => {
  const r = await req('POST', '/api/runs', { body: { skill: 'does-not-exist' } });
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /not available/);
});
