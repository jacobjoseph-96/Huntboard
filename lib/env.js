// Optional API keys for some job boards, read from .env in the project folder or the workspace
// (KEY=value lines). Real environment variables win.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

let cache = null;

function parse(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // no file
  }
  return out;
}

function load() {
  if (!cache) cache = { ...parse(path.join(paths.ROOT, '.env')), ...parse(paths.ws('.env')) };
  return cache;
}

function get(name) {
  return process.env[name] || load()[name] || '';
}

function reset() {
  cache = null;
}

module.exports = { get, reset };
