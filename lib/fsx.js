// Small file helpers: atomic writes, JSON read with fallback, slugs, ids.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return clone(fallback);
    if (err.code === 'ENOENT') return undefined;
    throw new Error(`Cannot read ${file}: ${err.message}`);
  }
}

function writeAtomic(file, content) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      // Windows: a reader (or antivirus) may hold the file for a moment.
      if (i < 8 && ['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        sleepMs(25 * (i + 1));
        continue;
      }
      fs.rmSync(tmp, { force: true });
      throw err;
    }
  }
}

function writeJson(file, data) {
  writeAtomic(file, JSON.stringify(data, null, 2) + '\n');
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function clone(v) {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function slugify(s, max = 40) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '') || 'item';
}

function newId(prefix = '') {
  const t = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${prefix}${t}-${crypto.randomBytes(3).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

// Resolve `rel` inside `base`; returns null if it escapes base.
function safeJoin(base, rel) {
  const target = path.resolve(base, String(rel || ''));
  const root = path.resolve(base);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}

module.exports = { ensureDir, readJson, writeAtomic, writeJson, sleepMs, clone, slugify, newId, nowIso, safeJoin };
