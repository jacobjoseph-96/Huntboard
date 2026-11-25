// Which web browsers are installed, and which one Huntboard uses (settings.browser.choice).
// The chosen browser opens the app window, makes the PDFs (headless) and is the AI's browser for job boards
// (Playwright MCP, see tools/sync-agents.js). Only Chromium-based browsers can do all three; Firefox and Safari are
// listed so the user sees why they cannot be picked.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

// Chromium-based browsers with a Playwright channel start through it; the others through their program file.
const KNOWN = [
  { id: 'chrome', name: 'Google Chrome', chromium: true, channel: 'chrome' },
  { id: 'msedge', name: 'Microsoft Edge', chromium: true, channel: 'msedge' },
  { id: 'brave', name: 'Brave', chromium: true },
  { id: 'vivaldi', name: 'Vivaldi', chromium: true },
  { id: 'chromium', name: 'Chromium', chromium: true },
  { id: 'firefox', name: 'Mozilla Firefox', chromium: false },
  { id: 'safari', name: 'Safari', chromium: false },
];

function locations(id) {
  const env = process.env;
  const pf = env.ProgramFiles || 'C:\\Program Files';
  const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const win = (rel) => (process.platform === 'win32' ? [pf, pf86, env.LOCALAPPDATA].filter(Boolean).map((base) => path.join(base, rel)) : []);
  switch (id) {
    case 'chrome': return [...win('Google\\Chrome\\Application\\chrome.exe'),
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
    case 'msedge': return [...win('Microsoft\\Edge\\Application\\msedge.exe'),
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
    case 'brave': return [...win('BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser', '/usr/bin/brave-browser', '/usr/bin/brave', '/snap/bin/brave'];
    case 'vivaldi': return [...win('Vivaldi\\Application\\vivaldi.exe'),
      '/Applications/Vivaldi.app/Contents/MacOS/Vivaldi', '/usr/bin/vivaldi', '/usr/bin/vivaldi-stable'];
    case 'chromium': return [...win('Chromium\\Application\\chrome.exe'),
      '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
    case 'firefox': return [...win('Mozilla Firefox\\firefox.exe'),
      '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox', '/snap/bin/firefox'];
    case 'safari': return ['/Applications/Safari.app/Contents/MacOS/Safari'];
    default: return [];
  }
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Every known browser with its program file ('' when it is not installed).
function detect() {
  return KNOWN.map((b) => ({ ...b, path: locations(b.id).find(isFile) || '' }));
}

function chosenId(settings) {
  if (settings) return String((settings.browser || {}).choice || '');
  try {
    return String(((JSON.parse(fs.readFileSync(paths.settingsFile(), 'utf8')) || {}).browser || {}).choice || '');
  } catch {
    return '';
  }
}

// The browser Huntboard uses: CHROME_PATH, else the user's choice while it is installed, else the first installed
// Chromium-based browser. null when there is none. `settings` is optional (read from workspace/settings.json).
function current(settings) {
  const own = process.env.CHROME_PATH;
  if (own && isFile(own)) return { id: 'custom', name: path.basename(own), chromium: true, path: own };
  const usable = detect().filter((b) => b.chromium && b.path);
  const want = chosenId(settings);
  return usable.find((b) => b.id === want) || usable[0] || null;
}

// The program file of the browser in use (PDFs, the app window, logo export).
function findChromium(settings) {
  const b = current(settings);
  return b ? b.path : null;
}

// The Playwright MCP arguments that start the browser in use.
function mcpArgs(settings) {
  const b = current(settings);
  if (!b) return ['--browser', 'chrome'];
  if (b.channel) return ['--browser', b.channel];
  // A given program file wins over the channel, so Brave, Vivaldi and Chromium start as themselves.
  return ['--browser', 'chrome', '--executable-path', b.path.split(path.sep).join('/')];
}

module.exports = { KNOWN, detect, current, findChromium, mcpArgs };
