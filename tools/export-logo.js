#!/usr/bin/env node
// Exports the logo SVGs in assets/logo/ to PNG with headless Chrome/Edge.
//   node tools/export-logo.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { findChromium } = require('../lib/browser');

const DIR = path.resolve(__dirname, '..', 'assets', 'logo');
const OUT = path.join(DIR, 'png');
const JOBS = [
  ['huntboard-badge.svg', 512, 512], ['huntboard-badge.svg', 128, 128], ['huntboard-badge.svg', 32, 32],
  ['huntboard-mark.svg', 512, 512],
  ['huntboard-logo.svg', 1080, 240], ['huntboard-logo-dark.svg', 1080, 240],
  ['social-preview.svg', 1280, 640],
];

const browser = findChromium();
if (!browser) {
  console.error('Chrome or Edge is needed to export the PNGs.');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-logo-'));
for (const [svg, w, h] of JOBS) {
  const page = path.join(tmp, `${svg}-${w}.html`);
  const dark = svg.includes('dark');
  fs.writeFileSync(page, `<!doctype html><html><body style="margin:0;background:${dark ? '#0f1413' : 'transparent'}"><img src="${pathToFileURL(path.join(DIR, svg)).href}" style="width:${w}px;height:${h}px;display:block"></body></html>`);
  const out = path.join(OUT, `${svg.replace('.svg', '')}-${w}.png`);
  spawnSync(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000', `--window-size=${w},${h}`, `--screenshot=${out}`, pathToFileURL(page).href], { timeout: 60000 });
  console.log(fs.existsSync(out) ? `✔ ${path.relative(process.cwd(), out)}` : `✖ ${svg} ${w}x${h}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
