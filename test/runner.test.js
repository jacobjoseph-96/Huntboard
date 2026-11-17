// The background runner with a fake AI tool (test/fixtures/mock-ai.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshWorkspace, ROOT } = require('./helpers');

freshWorkspace('runner');
const profileLib = require('../lib/profile');
const { Runner, classifyError, limitUntil, LIMIT } = require('../lib/ai/runner');
const { ADAPTERS } = require('../lib/ai/adapters');

const platforms = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'platforms.json'), 'utf8'));
platforms.tools.mock = { name: 'Mock AI', bin: [] };

function mockRunner(extraArgs = []) {
  const mock = { ...ADAPTERS.claude, args: ({ session }) => [...extraArgs, ...(session ? ['--resume', session] : [])] };
  return new Runner({
    platforms,
    adapters: { mock },
    resolve: () => ({ installed: true, command: process.execPath, prefixArgs: [path.join(ROOT, 'test', 'fixtures', 'mock-ai.js')] }),
  });
}

const finished = (runner, id) => new Promise((resolve) => runner.on('done', (r) => { if (r.id === id) resolve(r); }));

test('a skill run streams steps and finishes with the summary', async () => {
  profileLib.saveSettings({ ai: { tool: 'mock' } });
  const runner = mockRunner();
  const run = runner.enqueue({ kind: 'skill', skill: 'setup' });
  const done = await finished(runner, run.id);
  assert.strictEqual(done.status, 'done');
  assert.strictEqual(done.result_text, 'All done.');
  assert.deepStrictEqual(done.steps.map((s) => s.text), ['Looking at the board']);
  assert.strictEqual(done.session_id, 'mock-session-1');
  assert.ok(fs.existsSync(path.join(runner.dir(run.id), 'prompt.md')));
  assert.match(fs.readFileSync(path.join(runner.dir(run.id), 'prompt.md'), 'utf8'), /agent\/skills\/setup\/SKILL\.md/);
});

test('fully automatic runs get the stand-in rules and HUNTBOARD_PROXY', async () => {
  const p = profileLib.loadProfile();
  p.applying.mode = 'full_auto';
  p.applying.min_fit = 80;
  profileLib.saveProfile(p);
  const runner = mockRunner();
  const plain = runner.enqueue({ kind: 'skill', skill: 'setup' });
  assert.strictEqual(plain.proxy, false); // setup is not an applying task
  await finished(runner, plain.id);
  const run = runner.enqueue({ kind: 'skill', skill: 'setup', proxy: true });
  await finished(runner, run.id);
  const prompt = fs.readFileSync(path.join(runner.dir(run.id), 'prompt.md'), 'utf8');
  assert.match(prompt, /Fully automatic mode/);
  assert.match(prompt, /at least 80%/);
  p.applying.mode = 'assist';
  profileLib.saveProfile(p);
});

test('chat runs remember the session for the next message', async () => {
  const runner = mockRunner();
  const run = runner.enqueue({ kind: 'chat', message: 'Hello' });
  await finished(runner, run.id);
  assert.strictEqual(profileLib.loadSettings().ai.chat_sessions.mock, 'mock-session-1');
});

test('failures are explained in plain language', async () => {
  const runner = mockRunner(['--fail']);
  const run = runner.enqueue({ kind: 'test' });
  const done = await finished(runner, run.id);
  assert.strictEqual(done.status, 'failed');
  assert.strictEqual(done.error_kind, 'limit');
  assert.match(done.error, /usage limit/);
  assert.strictEqual(classifyError('Please log in first'), 'not_signed_in');
});

test('a run that hits the usage limit waits for the reset and continues its own session', async () => {
  profileLib.saveSettings({ ai: { tool: 'mock' } });
  limitUntil.mock = 0;
  const slack = LIMIT.slackMs;
  LIMIT.slackMs = 0;
  assert.strictEqual(classifyError("You've hit your session limit · resets 8:10pm (Europe/Berlin)"), 'limit');
  const runner = mockRunner(['--limit']);
  const seen = [];
  runner.on('run', (r) => { if (!seen.includes(r.status)) seen.push(r.status); });
  const run = runner.enqueue({ kind: 'skill', skill: 'setup' });
  const other = runner.enqueue({ kind: 'skill', skill: 'setup' });
  await new Promise((resolve) => runner.on('waiting', resolve));
  assert.strictEqual(runner.busy(), run.id); // the lane stays busy while it waits
  assert.ok(runner.active().some((r) => r.id === run.id && r.status === 'waiting_limit'));
  assert.ok(limitUntil.mock > Date.now());
  const done = await finished(runner, run.id);
  assert.strictEqual(done.status, 'done');
  assert.strictEqual(done.limit_waits, 1);
  assert.strictEqual(done.resume_session, 'mock-session-1'); // it had worked: the same session continued
  assert.deepStrictEqual(seen.slice(0, 3), ['queued', 'running', 'waiting_limit']);
  await finished(runner, other.id); // the queued run started only after the reset, and also finished
  LIMIT.slackMs = slack;
  limitUntil.mock = 0;
});

test('Stop on a waiting run cancels it as the user', async () => {
  limitUntil.mock = 0;
  const runner = mockRunner(['--limit']);
  const run = runner.enqueue({ kind: 'skill', skill: 'setup' });
  await new Promise((resolve) => runner.on('waiting', resolve));
  assert.ok(runner.cancel(run.id));
  const r = runner.get(run.id);
  assert.strictEqual(r.status, 'cancelled');
  assert.strictEqual(r.cancel_reason, 'user');
  assert.strictEqual(runner.busy(), null);
  limitUntil.mock = 0;
});

test('no AI tool chosen gives a clear message', async () => {
  profileLib.saveSettings({ ai: { tool: '' } });
  const runner = mockRunner();
  const run = runner.enqueue({ kind: 'test' });
  const done = await finished(runner, run.id);
  assert.match(done.error, /No AI tool is chosen/);
});
