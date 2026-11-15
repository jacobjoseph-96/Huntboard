// Updating Huntboard to the newest version without touching the user's data.
// Everything personal lives in workspace/ (and the optional .env); an update never writes there except for a
// backup and a note of the installed version. Two kinds of installs:
// - git clone → `git pull --ff-only` (refused when the user changed program files, so nothing is lost);
// - downloaded zip → the newest archive of the branch is downloaded and its files are copied over the program
//   files; workspace/, .env, .git and node_modules are never touched.
// Then `npm install` (which also refreshes the AI instruction files) and the data migrations (lib/migrate.js).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('./paths');
const { readJson, writeJson, ensureDir, nowIso } = require('./fsx');

const ROOT = paths.ROOT;
const BRANCH = 'main';
const KEEP_BACKUPS = 3;
// Never written by an update (relative to the program folder, forward slashes).
const PROTECTED = [/^workspace(\/|$)/, /^node_modules(\/|$)/, /^\.git(\/|$)/, /^\.env(\.|$)/, /^backups(\/|$)/];
// Not copied into a backup: big, rebuilt by themselves, or only temporary.
const NO_BACKUP = new Set(['browser-profile', 'app-window', 'tmp', 'runs', 'backups']);

const pkg = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const installFile = () => path.join(paths.dataDir(), 'install.json');

function repo() {
  const url = String((pkg().repository || {}).url || '');
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
  return m ? { owner: m[1], name: m[2] } : null;
}

function git(args, opts = {}) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: opts.timeout || 60000, windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0 && !opts.allowFail) throw new Error((r.stderr || r.stdout || `git ${args[0]} failed`).trim().split('\n').slice(-3).join(' '));
  return (r.stdout || '').trim();
}

function installType() {
  if (!fs.existsSync(path.join(ROOT, '.git'))) return 'zip';
  try {
    git(['--version']);
    return 'git';
  } catch {
    return 'zip';
  }
}

// a > b for "1.2.3" versions
function newer(a, b) {
  const pa = String(a || '0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function getJson(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, { headers: { 'user-agent': 'Huntboard-updater', accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res.json();
}

// What is installed and what is newest. Never changes anything (a git install only fetches).
async function check({ fetchImpl } = {}) {
  const current = pkg().version;
  const type = installType();
  if (type === 'git') {
    git(['fetch', '--quiet', 'origin', BRANCH], { timeout: 60000 });
    const behind = Number(git(['rev-list', '--count', `HEAD..origin/${BRANCH}`])) || 0;
    const changes = behind ? git(['log', '--format=%s', '-n', '15', `HEAD..origin/${BRANCH}`]).split('\n').filter(Boolean) : [];
    let latest = current;
    try {
      latest = JSON.parse(git(['show', `origin/${BRANCH}:package.json`])).version || current;
    } catch { /* keep current */ }
    const changed = git(['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean).map((l) => l.slice(3));
    return { type, current, latest, available: behind > 0, behind, changes, blocked: behind && changed.length ? changed : [], checked_at: nowIso() };
  }
  const r = repo();
  if (!r) throw new Error('package.json has no GitHub repository, so there is nowhere to update from.');
  const head = await getJson(`https://api.github.com/repos/${r.owner}/${r.name}/commits/${BRANCH}`, fetchImpl);
  const sha = head.sha;
  let latest = current;
  try {
    latest = (await getJson(`https://raw.githubusercontent.com/${r.owner}/${r.name}/${sha}/package.json`, fetchImpl)).version || current;
  } catch { /* keep current */ }
  const installed = readJson(installFile(), {});
  const available = installed.sha ? installed.sha !== sha : newer(latest, current);
  return {
    type, current, latest, sha, available, behind: null, blocked: [], checked_at: nowIso(),
    changes: head.commit && head.commit.message ? [head.commit.message.split('\n')[0]] : [],
    // A zip install from before this feature does not know its exact version: it may update anyway.
    unknown: !installed.sha && !available,
  };
}

// A copy of the user's data (except big browser profiles and temporary files) in workspace/backups/<time>/.
function backup() {
  const src = paths.ws();
  if (!fs.existsSync(src)) return null;
  const dir = paths.ws('backups', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  ensureDir(dir);
  for (const name of fs.readdirSync(src)) {
    if (NO_BACKUP.has(name)) continue;
    fs.cpSync(path.join(src, name), path.join(dir, name), { recursive: true, force: true, errorOnExist: false });
  }
  const all = fs.readdirSync(paths.ws('backups')).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.rmSync(paths.ws('backups', old), { recursive: true, force: true });
  return dir;
}

const isProtected = (rel) => PROTECTED.some((re) => re.test(rel));

// Copy the files of a downloaded archive over the program folder. Files of the old version that the new one no
// longer has are removed (only the ones the last update wrote, never anything the user added).
function installFiles(entries, root = ROOT, { log = () => {} } = {}) {
  const strip = (n) => n.replace(/^[^/]+\//, ''); // GitHub archives put everything in "<repo>-<sha>/"
  const files = entries.filter((e) => e.type === 'file').map((e) => ({ rel: strip(e.name), data: e.data })).filter((f) => f.rel && !isProtected(f.rel) && !f.rel.split('/').includes('..'));
  if (!files.some((f) => f.rel === 'package.json')) throw new Error('The download does not look like Huntboard (no package.json).');
  const prev = readJson(installFile(), {}).files || [];
  for (const f of files) {
    const out = path.join(root, ...f.rel.split('/'));
    ensureDir(path.dirname(out));
    fs.writeFileSync(out, f.data);
  }
  const now = new Set(files.map((f) => f.rel));
  let removed = 0;
  for (const rel of prev) {
    if (now.has(rel) || isProtected(rel)) continue;
    const p = path.join(root, ...rel.split('/'));
    if (fs.existsSync(p)) { fs.rmSync(p, { force: true }); removed++; }
  }
  log(`${files.length} program files updated${removed ? `, ${removed} old ones removed` : ''}.`);
  return files.map((f) => f.rel);
}

function npmInstall() {
  const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], {
    cwd: ROOT, encoding: 'utf8', timeout: 15 * 60000, shell: process.platform === 'win32', windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`npm install failed: ${((r.stderr || r.stdout || r.error || '') + '').trim().split('\n').slice(-4).join(' ')}`);
}

// Update now. log(text) reports progress. Returns { from, to, backup, type }.
async function apply({ log = () => {}, fetchImpl = globalThis.fetch, skipInstall = false } = {}) {
  const from = pkg().version;
  const type = installType();
  log('Saving a backup of your data…');
  const saved = backup();
  if (saved) log(`Backup: ${paths.rel(saved)}`);
  if (type === 'git') {
    const changed = git(['status', '--porcelain', '--untracked-files=no']).split('\n').filter(Boolean).map((l) => l.slice(3));
    if (changed.length) {
      throw new Error(`These program files were changed on this computer, so the update stops to keep your changes: ${changed.slice(0, 8).join(', ')}. `
        + 'Undo the changes (git checkout -- <file>) or ask for help, then update again. Your data in workspace/ is fine.');
    }
    log('Getting the newest version (git pull)…');
    git(['pull', '--ff-only', 'origin', BRANCH], { timeout: 180000 });
  } else {
    const r = repo();
    if (!r) throw new Error('package.json has no GitHub repository, so there is nowhere to update from.');
    const head = await getJson(`https://api.github.com/repos/${r.owner}/${r.name}/commits/${BRANCH}`, fetchImpl);
    log('Downloading the newest version…');
    const res = await fetchImpl(`https://codeload.github.com/${r.owner}/${r.name}/tar.gz/${head.sha}`, { headers: { 'user-agent': 'Huntboard-updater' } });
    if (!res.ok) throw new Error(`The download failed (${res.status}). Check the internet connection and try again.`);
    const tgz = Buffer.from(await res.arrayBuffer());
    const entries = require('./tar').list(tgz);
    const files = installFiles(entries, ROOT, { log });
    writeJson(installFile(), { sha: head.sha, installed_at: nowIso(), files });
  }
  if (!skipInstall) {
    log('Installing what the new version needs (npm install)…');
    npmInstall();
  }
  log('Updating your data for the new version…');
  // A fresh copy of the migrations: the update may have brought new ones.
  delete require.cache[require.resolve('./migrate')];
  require('./migrate').runAll({ log });
  const to = pkg().version;
  if (type === 'git') writeJson(installFile(), { sha: git(['rev-parse', 'HEAD']), installed_at: nowIso() });
  log(`Done: Huntboard ${from} → ${to}.`);
  return { from, to, backup: saved ? paths.rel(saved) : null, type };
}

module.exports = { check, apply, backup, installFiles, installType, newer, repo, isProtected };
