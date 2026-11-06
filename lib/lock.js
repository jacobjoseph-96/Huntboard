// Cross-process lock based on an exclusive lock file holding the owner's pid.
// A lock whose owner process is gone, or that is older than `staleMs`, is taken over.

const fs = require('fs');
const path = require('path');
const { ensureDir, sleepMs } = require('./fsx');
const paths = require('./paths');

function pidAlive(pid) {
  if (!pid || pid === process.pid) return pid === process.pid;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

function lockFile(name) {
  return path.join(paths.dataDir(), 'locks', `${name}.lock`);
}

function tryAcquire(name, { staleMs = 60000 } = {}) {
  const file = lockFile(name);
  ensureDir(path.dirname(file));
  try {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  let info = {};
  try {
    info = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // half-written lock: treat as stale below
  }
  const stale = !pidAlive(info.pid) || Date.now() - (info.at || 0) > staleMs;
  if (stale) {
    fs.rmSync(file, { force: true });
    return tryAcquire(name, { staleMs });
  }
  return false;
}

function release(name) {
  const file = lockFile(name);
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (info.pid === process.pid) fs.rmSync(file, { force: true });
  } catch {
    // already gone
  }
}

// Run fn while holding the lock; waits up to timeoutMs.
function withLock(name, fn, { timeoutMs = 10000, staleMs = 60000 } = {}) {
  const start = Date.now();
  while (!tryAcquire(name, { staleMs })) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for lock "${name}"`);
    sleepMs(40);
  }
  try {
    return fn();
  } finally {
    release(name);
  }
}

module.exports = { withLock, tryAcquire, release, pidAlive };
