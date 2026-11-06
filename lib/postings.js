// Every job ad Huntboard has seen (workspace/data/postings.json, ad texts in data/ads/).
// Upsert rules: first_seen is never overwritten, and a blank field never replaces a known one.
// status: new → candidate (passed the filters, waits for the AI) → ticket | skipped | dropped | unread

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('./paths');
const { readJson, writeJson, writeAtomic, ensureDir, nowIso } = require('./fsx');
const { withLock } = require('./lock');
const { linkKey } = require('./dedupe');

const file = () => path.join(paths.dataDir(), 'postings.json');
const adsDir = () => path.join(paths.dataDir(), 'ads');
const FIELDS = ['title', 'company', 'location', 'posted', 'url', 'salary', 'job_type'];

function keyOf(r) {
  if (r.source && r.native_id) return `${String(r.source).toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${r.native_id}`;
  return linkKey(r.url) || `title:${crypto.createHash('sha1').update(`${r.title}|${r.company}|${r.location}`).digest('hex').slice(0, 16)}`;
}

function loadAll() {
  return readJson(file(), { items: {} }).items;
}

function saveAll(items) {
  writeJson(file(), { items });
}

function bodyFile(key) {
  return path.join(adsDir(), `${crypto.createHash('sha1').update(key).digest('hex').slice(0, 20)}.txt`);
}

function readBody(key) {
  try {
    return fs.readFileSync(bodyFile(key), 'utf8');
  } catch {
    return '';
  }
}

function writeBody(key, text) {
  ensureDir(adsDir());
  writeAtomic(bodyFile(key), String(text || ''));
}

// Returns [{ key, isNew, item }] in the order given.
function upsert(rows, { target = null, run = null } = {}) {
  return withLock('postings', () => {
    const items = loadAll();
    const out = [];
    for (const r of rows) {
      const key = keyOf(r);
      const old = items[key];
      const item = old ? { ...old } : { key, source: r.source || '', native_id: String(r.native_id || ''), first_seen: nowIso(), status: 'new', targets: [] };
      for (const f of FIELDS) if (r[f] && String(r[f]).trim()) item[f] = String(r[f]).trim().slice(0, 600);
      if (r.remote) item.remote = true;
      item.last_seen = nowIso();
      if (target && !item.targets.includes(target)) item.targets.push(target);
      if (run) item.last_run = run;
      if (r.body && String(r.body).length > readBody(key).length) {
        writeBody(key, r.body);
        item.has_body = true;
      }
      items[key] = item;
      out.push({ key, isNew: !old, item });
    }
    saveAll(items);
    return out;
  });
}

function update(key, patch) {
  return withLock('postings', () => {
    const items = loadAll();
    if (!items[key]) return null;
    items[key] = { ...items[key], ...patch, updated_at: nowIso() };
    saveAll(items);
    return items[key];
  });
}

function setMany(keys, patch) {
  return withLock('postings', () => {
    const items = loadAll();
    for (const k of keys) if (items[k]) items[k] = { ...items[k], ...patch, updated_at: nowIso() };
    saveAll(items);
  });
}

function get(key) {
  return loadAll()[key] || null;
}

function list({ status, target } = {}) {
  return Object.values(loadAll())
    .filter((i) => (!status || i.status === status) && (!target || i.targets.includes(target)))
    .sort((a, b) => String(b.posted || b.first_seen).localeCompare(String(a.posted || a.first_seen)));
}

module.exports = { keyOf, upsert, update, setMany, get, list, readBody, writeBody };
