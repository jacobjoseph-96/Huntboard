const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./helpers');

test('generated instruction files (AGENTS.md, CLAUDE.md, GEMINI.md) are up to date', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'sync-agents.js'), '--check'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});
