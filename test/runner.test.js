// The background runner with a fake AI tool (test/fixtures/mock-ai.js).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshWorkspace, ROOT } = require('./helpers');

freshWorkspace('runner');
const profileLib = require('../lib/profile');
const { Runner, classifyError } = require('../lib/ai/runner');
const { ADAPTERS } = require('../lib/ai/adapters');

const platforms = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'platforms.json'), 'utf8'));
platforms.tools.mock = { name: 'Mock AI', bin: [] };

function mockRunner(extraArgs = []) {
  const mock = { ...ADAPTERS.claude, args: () => extraArgs };
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

test('no AI tool chosen gives a clear message', async () => {
  profileLib.saveSettings({ ai: { tool: '' } });
  const runner = mockRunner();
  const run = runner.enqueue({ kind: 'test' });
  const done = await finished(runner, run.id);
  assert.match(done.error, /No AI tool is chosen/);
});
