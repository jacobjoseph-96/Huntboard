// Fully automatic mode: the AI acts as the user's stand-in. Every decision it takes for the user is
// written to workspace/data/decisions.jsonl, so the user gets a "while you were away" report.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { ensureDir, nowIso } = require('./fsx');

const file = () => path.join(paths.dataDir(), 'decisions.jsonl');

function logDecision({ text, ticket = null, run_id = null, question = null }) {
  const body = String(text || '').trim().slice(0, 2000);
  if (!body) throw new Error('A decision needs a text.');
  const entry = { at: nowIso(), text: body, ticket, run_id, question: question ? String(question).slice(0, 2000) : null };
  ensureDir(path.dirname(file()));
  fs.appendFileSync(file(), JSON.stringify(entry) + '\n');
  return entry;
}

function listDecisions({ since = null, run_id = null, limit = 200 } = {}) {
  if (!fs.existsSync(file())) return [];
  const out = [];
  for (const line of fs.readFileSync(file(), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (since && e.at < since) continue;
      if (run_id && e.run_id !== run_id) continue;
      out.push(e);
    } catch {
      // skip a broken line
    }
  }
  return out.slice(-limit);
}

// The text a question returns when nobody answered in time during a fully automatic run.
const DECIDE_YOURSELF = [
  'NO ANSWER: the user is away and chose fully automatic mode. Decide for them as their stand-in:',
  '- Pick what their profile, search targets, form answers and notes say, or what a careful person in their place would pick.',
  '- Record what you decided and why: node tools/hunt.js decide "<decision and reason>" --ticket <KEY>',
  '- If it needs something only they can do (a robot check, a login, a password, a fact that is not in their data),',
  '  do NOT guess: run node tools/hunt.js needs <KEY> "<what is needed>", skip this job and continue with the next one.',
].join('\n');

module.exports = { logDecision, listDecisions, DECIDE_YOURSELF };
