// Every test file gets its own empty workspace before any Huntboard module is loaded.
const fs = require('fs');
const os = require('os');
const path = require('path');

function freshWorkspace(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hb-test-${name}-`));
  process.env.HUNTBOARD_WORKSPACE = dir;
  return dir;
}

module.exports = { freshWorkspace, ROOT: path.resolve(__dirname, '..') };
