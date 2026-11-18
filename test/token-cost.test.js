// Token cost: a short inbox at session start, lean Claude runs, sensible default models, chats that roll over.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { freshWorkspace, ROOT } = require('./helpers');

const ws = freshWorkspace('token-cost');
const store = require('../lib/store');
const routing = require('../lib/ai/routing');
const { ADAPTERS } = require('../lib/ai/adapters');

const hunt = (args, env = {}) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'hunt.js'), ...args], {
  encoding: 'utf8', env: { ...process.env, HUNTBOARD_WORKSPACE: ws, HUNTBOARD_HEADLESS: '', ...env },
});

test('the session-start inbox is a short summary, and empty in headless runs', () => {
  const jobs = Array.from({ length: 30 }, (_, i) => ({ title: `Job ${i}`, company: `Firma ${i}`, link: `https://example.com/job/${i}` }));
  const file = path.join(ws, 'jobs.json');
  fs.writeFileSync(file, JSON.stringify(jobs));
  assert.strictEqual(hunt(['add', file]).status, 0);
  for (const t of store.listTickets()) store.setNeeds(t.key, `Something long only the user can do for ${t.company} `.repeat(5));
  const out = hunt(['inbox', '--hook']).stdout;
  assert.match(out, /30 need you/);
  assert.match(out, /and \d+ more/);
  assert.strictEqual(out.trim().split('\n').length, 7, 'a header, 5 items and the rest as a count');
  assert.ok(out.length < 1500, `hook output is ${out.length} chars`);
  assert.strictEqual(hunt(['inbox', '--hook'], { HUNTBOARD_HEADLESS: '1' }).stdout, '');
  assert.ok(hunt(['inbox']).stdout.split('\n').length > 30, 'the full inbox still lists everything');
});

test('Claude runs load only the folder\'s MCP servers, a lean browser and the tier\'s effort', () => {
  const claude = Object.values(ADAPTERS).find((a) => a.id === 'claude');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-run-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-cwd-'));
  fs.writeFileSync(path.join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { playwright: { command: 'npx', args: ['-y', '@playwright/mcp@latest', '--extension'] } } }));
  const prep = claude.prepare({ runDir: dir, cwd, tier: 'light' });
  const args = claude.args({ prompt: 'x', fullAccess: true, platforms: { allow: { commands: ['node tools/hunt.js'] } }, ...prep });
  assert.ok(args.includes('--strict-mcp-config'));
  assert.strictEqual(args[args.indexOf('--effort') + 1], 'low');
  assert.ok(args.includes('--disable-slash-commands'));
  const mcp = JSON.parse(fs.readFileSync(args[args.indexOf('--mcp-config') + 1], 'utf8'));
  assert.deepStrictEqual(Object.keys(mcp.mcpServers), ['playwright']);
  assert.ok(mcp.mcpServers.playwright.args.join(' ').includes('--snapshot-mode none'));
  // A folder without .mcp.json: no strict config (the tool's own servers stay).
  const bare = claude.prepare({ runDir: dir, cwd: dir, tier: 'strong' });
  assert.strictEqual(bare.mcpConfig, null);
  assert.strictEqual(bare.effort, 'high');
});

test('with no model set, Claude tasks use haiku / sonnet / opus by tier', () => {
  assert.strictEqual(routing.modelFor({ ai: {} }, 'claude', 'chat'), 'sonnet');
  assert.strictEqual(routing.modelFor({ ai: {} }, 'claude', 'tailor'), 'opus');
  assert.strictEqual(routing.modelFor({ ai: {} }, 'claude', 'test'), 'haiku');
  assert.strictEqual(routing.modelFor({ ai: { model: 'x' } }, 'claude', 'tailor'), 'x', 'the user\'s own model wins');
  assert.strictEqual(routing.modelFor({ ai: {} }, 'gemini', 'chat'), '', 'other tools keep their own default');
});
