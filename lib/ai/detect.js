// Finds installed AI command-line tools and how to start them without a shell.
// On Windows, npm installs .cmd shims; we read the shim and start the real .exe / .js directly,
// so no command line is ever parsed by cmd.exe.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';

function expandEnv(p) {
  return p.replace(/%([^%]+)%/g, (_, k) => process.env[k] || '').replace(/^~(?=[\\/])/, require('os').homedir());
}

function which(bin) {
  const r = IS_WIN
    ? spawnSync('where', [bin], { encoding: 'utf8', windowsHide: true })
    : spawnSync('sh', ['-c', `command -v ${bin.replace(/[^\w.-]/g, '')}`], { encoding: 'utf8' });
  if (r.status !== 0) return [];
  return String(r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

// Turn a found path into { command, prefixArgs } that spawn() can run with shell:false.
function launchSpec(file) {
  const ext = path.extname(file).toLowerCase();
  if (!IS_WIN || ext === '.exe') return { command: file, prefixArgs: [] };
  if (ext === '.cmd' || ext === '.bat') {
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/"%dp0%\\([^"]+?\.(?:exe|js|cjs|mjs))"/i) || text.match(/"%~dp0\\([^"]+?\.(?:exe|js|cjs|mjs))"/i);
    if (m) {
      const target = path.join(path.dirname(file), m[1]);
      if (fs.existsSync(target)) {
        return /\.exe$/i.test(target) ? { command: target, prefixArgs: [] } : { command: process.execPath, prefixArgs: [target] };
      }
    }
    return null;
  }
  return null;
}

function resolveTool(tool) {
  const found = [];
  for (const bin of tool.bin || []) found.push(...which(bin));
  for (const p of tool.extra_paths || []) {
    const abs = expandEnv(p);
    if (fs.existsSync(abs)) found.push(abs);
  }
  // Prefer .exe, then .cmd shims we can unwrap.
  const ordered = IS_WIN
    ? [...found.filter((f) => /\.exe$/i.test(f)), ...found.filter((f) => /\.(cmd|bat)$/i.test(f))]
    : found;
  for (const f of ordered) {
    const spec = launchSpec(f);
    if (spec) return { installed: true, path: f, ...spec };
  }
  return { installed: found.length > 0, path: found[0] || null, command: null, prefixArgs: [] };
}

module.exports = { resolveTool, launchSpec, which, IS_WIN };
