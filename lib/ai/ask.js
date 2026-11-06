// Questions from the AI to the user. The AI runs `node tools/hunt.js ask "..."`, the app shows a dialog,
// the answer goes back to the AI. Stored as files so the CLI and the server share them.

const fs = require('fs');
const path = require('path');
const paths = require('../paths');
const { ensureDir, readJson, writeJson, newId, nowIso } = require('../fsx');

function file(id) {
  return path.join(paths.asksDir(), `${String(id).replace(/[^\w-]/g, '')}.json`);
}

// proxy = asked during a fully automatic run: the AI decides itself if nobody answers within proxy_wait_seconds.
function create({ question, choices = [], kind = 'question', run_id = null, ticket = null, details = '', proxy = false }) {
  const q = String(question || '').trim().slice(0, 4000);
  if (!q) throw new Error('An ask needs a question.');
  const ask = {
    id: newId('ask-'),
    question: q,
    details: String(details || '').slice(0, 8000),
    choices: [].concat(choices).map((c) => String(c).trim()).filter(Boolean).slice(0, 8),
    kind,
    proxy: Boolean(proxy),
    run_id,
    ticket,
    status: 'pending',
    created_at: nowIso(),
    answer: null,
    answered_at: null,
  };
  ensureDir(paths.asksDir());
  writeJson(file(ask.id), ask);
  return ask;
}

function get(id) {
  return readJson(file(id)) || null;
}

function answer(id, value) {
  const ask = get(id);
  if (!ask) throw new Error(`No question ${id}`);
  if (ask.status !== 'pending') return ask;
  ask.status = 'answered';
  ask.answer = String(value == null ? '' : value).slice(0, 8000);
  ask.answered_at = nowIso();
  writeJson(file(id), ask);
  return ask;
}

function cancel(id, reason = 'cancelled') {
  const ask = get(id);
  if (!ask || ask.status !== 'pending') return ask;
  ask.status = reason;
  ask.answered_at = nowIso();
  writeJson(file(id), ask);
  return ask;
}

function listPending() {
  const dir = paths.asksDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f)))
    .filter((a) => a && a.status === 'pending')
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

module.exports = { create, get, answer, cancel, listPending };
