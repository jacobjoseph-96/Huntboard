const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const browsers = require('../lib/browser');

const pf = process.env.ProgramFiles || 'C:\\Program Files';

test('detect lists every known browser, installed or not', () => {
  const all = browsers.detect();
  assert.deepStrictEqual(all.map((b) => b.id), browsers.KNOWN.map((b) => b.id));
  for (const b of all) assert.strictEqual(typeof b.path, 'string');
  assert.ok(!all.find((b) => b.id === 'firefox').chromium, 'Firefox cannot be used');
});

test('the chosen browser is used while installed; otherwise the first installed one', () => {
  const usable = browsers.detect().filter((b) => b.chromium && b.path);
  if (!usable.length) return;
  const last = usable[usable.length - 1];
  assert.strictEqual(browsers.current({ browser: { choice: last.id } }).id, last.id);
  assert.strictEqual(browsers.current({ browser: { choice: 'not-a-browser' } }).id, usable[0].id);
  assert.strictEqual(browsers.current({ browser: { choice: '' } }).id, usable[0].id);
});

test('mcpArgs: a channel for Chrome/Edge, the program file for other Chromium browsers', () => {
  const usable = browsers.detect().filter((b) => b.chromium && b.path);
  for (const b of usable) {
    const args = browsers.mcpArgs({ browser: { choice: b.id } });
    if (b.channel) assert.deepStrictEqual(args, ['--browser', b.channel]);
    else assert.deepStrictEqual(args, ['--browser', 'chrome', '--executable-path', b.path.split(path.sep).join('/')]);
  }
});

test('CHROME_PATH wins over the choice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-browser-'));
  const exe = path.join(dir, 'mybrowser.exe');
  fs.writeFileSync(exe, '');
  const old = process.env.CHROME_PATH;
  process.env.CHROME_PATH = exe;
  try {
    assert.strictEqual(browsers.findChromium({ browser: { choice: 'msedge' } }), exe);
    assert.deepStrictEqual(browsers.mcpArgs(), ['--browser', 'chrome', '--executable-path', exe.split(path.sep).join('/')]);
  } finally {
    if (old === undefined) delete process.env.CHROME_PATH;
    else process.env.CHROME_PATH = old;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Edge is found on Windows', { skip: process.platform !== 'win32' || !fs.existsSync(path.join(pf, 'Microsoft\\Edge\\Application\\msedge.exe')) && !fs.existsSync(path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft\\Edge\\Application\\msedge.exe')) }, () => {
  assert.ok(browsers.detect().find((b) => b.id === 'msedge').path);
});
