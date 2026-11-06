// HTML → A4 PDF with headless Chrome/Edge, plus a page count.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { findChromium } = require('./browser');

function countPages(pdfFile) {
  return (fs.readFileSync(pdfFile, 'latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

function htmlToPdf(htmlFile, pdfFile) {
  const html = path.resolve(htmlFile);
  if (!fs.existsSync(html)) throw new Error(`File not found: ${html}`);
  const pdf = path.resolve(pdfFile || html.replace(/\.html?$/i, '') + '.pdf');
  const browser = findChromium();
  if (!browser) throw new Error('Google Chrome or Microsoft Edge was not found. Install Chrome (or set CHROME_PATH) and try again.');
  // Separate profile so it works while the normal browser is open.
  const profile = path.join(os.tmpdir(), 'huntboard-pdf-profile');
  fs.rmSync(pdf, { force: true });
  const result = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${profile}`,
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

module.exports = { htmlToPdf, countPages };
