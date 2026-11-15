// One-time changes to the user's data when a new version of Huntboard needs them. Each migration runs once per
// workspace; the ones that ran are recorded in workspace/data/migrations.json. They run when the app starts and
// right after an update, and never delete anything.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { readJson, writeJson, nowIso } = require('./fsx');

const file = () => path.join(paths.dataDir(), 'migrations.json');

const MIGRATIONS = [
  {
    id: '2026-11-ticket-links',
    what: 'Give jobs found by a search the link to their ad (it was lost when they were added)',
    run() {
      const store = require('./store');
      const postings = require('./postings');
      const byTicket = new Map();
      for (const item of postings.list()) if (item.ticket && item.url) byTicket.set(item.ticket, item.url);
      let n = 0;
      for (const t of store.listTickets()) {
        if (t.link || !byTicket.has(t.key)) continue;
        store.setFields(t.key, { link: byTicket.get(t.key) }, { by: 'agent' });
        n++;
      }
      return `${n} ticket(s) got their link back`;
    },
  },
  {
    id: '2026-11-places-and-names',
    what: 'Searches: several places per search, and unnamed searches show their name as a hint',
    run() {
      if (!fs.existsSync(paths.profileFile())) return 'no profile yet';
      const profileLib = require('./profile');
      profileLib.saveProfile(profileLib.loadProfile());
      return 'profile updated';
    },
  },
];

function state() {
  return readJson(file(), { done: {} });
}

function pending() {
  const done = state().done || {};
  return MIGRATIONS.filter((m) => !done[m.id]);
}

// Runs what has not run yet. A migration that fails is reported and tried again next time.
function runAll({ log = () => {} } = {}) {
  const s = state();
  s.done = s.done || {};
  const results = [];
  for (const m of MIGRATIONS) {
    if (s.done[m.id]) continue;
    try {
      const out = m.run();
      s.done[m.id] = nowIso();
      results.push({ id: m.id, ok: true, out });
      log(`${m.what}: ${out}`);
    } catch (err) {
      results.push({ id: m.id, ok: false, error: err.message });
      log(`${m.what}: FAILED (${err.message}); it is tried again next time`);
    }
  }
  if (results.length) writeJson(file(), s);
  return results;
}

module.exports = { runAll, pending, MIGRATIONS, file };
