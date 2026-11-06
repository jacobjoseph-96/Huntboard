#!/usr/bin/env node
// A fake AI tool for tests: prints a Claude-like JSON stream. With --ask it asks the user through hunt ask.
const { spawnSync } = require('child_process');
const path = require('path');

const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
out({ type: 'system', subtype: 'init', session_id: 'mock-session-1' });
out({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node tools/hunt.js list' } }] } });
let answer = '';
if (process.argv.includes('--ask')) {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', '..', 'tools', 'hunt.js'), 'ask', 'Pick one', '--choices', 'A,B', '--timeout', '1'], { encoding: 'utf8', env: process.env });
  answer = (r.stdout || '').trim();
}
if (process.argv.includes('--fail')) {
  process.stderr.write('Error: rate limit reached\n');
  process.exit(1);
}
out({ type: 'result', subtype: 'success', is_error: false, result: `All done. ${answer}`.trim(), session_id: 'mock-session-1' });
