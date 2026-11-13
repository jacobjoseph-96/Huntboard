// HTML → A4 PDF with headless Chrome/Edge, plus a page count. Also a picture of the first page (for previews).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { findChromium } = require('./browser');

function countPages(pdfFile) {
  return (fs.readFileSync(pdfFile, 'latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

// Separate profile so it works while the normal browser is open.
const browserProfile = () => path.join(os.tmpdir(), 'huntboard-pdf-profile');
const BASE_ARGS = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check'];

function chromium() {
  const browser = findChromium();
  if (!browser) throw new Error('Google Chrome or Microsoft Edge was not found. Install Chrome (or set CHROME_PATH) and try again.');
  return browser;
}

function htmlToPdf(htmlFile, pdfFile) {
  const html = path.resolve(htmlFile);
  if (!fs.existsSync(html)) throw new Error(`File not found: ${html}`);
  const pdf = path.resolve(pdfFile || html.replace(/\.html?$/i, '') + '.pdf');
  const browser = chromium();
  fs.rmSync(pdf, { force: true });
  const result = spawnSync(browser, [
    ...BASE_ARGS,
    `--user-data-dir=${browserProfile()}`,
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=3000',
    `--print-to-pdf=${pdf}`,
    pathToFileURL(html).href,
  ], { timeout: 90000, encoding: 'utf8' });
  if (!fs.existsSync(pdf) || fs.statSync(pdf).size === 0) {
    throw new Error(`The PDF was not created.\n${result.error || ''}${result.stderr || ''}`.trim());
  }
  return { pdf, pages: countPages(pdf) };
}

// A PNG of the top of an HTML page at A4 width (794 × 1123 px = one A4 page at 96 dpi).
function htmlToPng(htmlFile, pngFile, { width = 794, height = 1123, scale = 1 } = {}) {
  const html = path.resolve(htmlFile);
  if (!fs.existsSync(html)) throw new Error(`File not found: ${html}`);
  const png = path.resolve(pngFile || html.replace(/\.html?$/i, '') + '.png');
  const browser = chromium();
  fs.rmSync(png, { force: true });
  const result = spawnSync(browser, [
    ...BASE_ARGS,
    `--user-data-dir=${browserProfile()}`,
    '--hide-scrollbars',
    `--force-device-scale-factor=${Number(scale) > 0 ? Number(scale) : 1}`,
    `--window-size=${width},${height}`,
    '--virtual-time-budget=3000',
    `--screenshot=${png}`,
    pathToFileURL(html).href,
  ], { timeout: 90000, encoding: 'utf8' });
  if (!fs.existsSync(png) || fs.statSync(png).size === 0) {
    throw new Error(`The picture was not created.\n${result.error || ''}${result.stderr || ''}`.trim());
  }
  return png;
}

// Runs a page and returns its final HTML (used to shrink a photo with the browser's own canvas).
function dumpDom(htmlFile) {
  const result = spawnSync(chromium(), [
    ...BASE_ARGS,
    `--user-data-dir=${browserProfile()}`,
    '--virtual-time-budget=8000',
    '--dump-dom',
    pathToFileURL(path.resolve(htmlFile)).href,
  ], { timeout: 60000, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024 });
  return String(result.stdout || '');
}

module.exports = { htmlToPdf, htmlToPng, dumpDom, countPages };
