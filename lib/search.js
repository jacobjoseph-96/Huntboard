// One search for one search target: collect from the API boards in the plan, filter, read the ad texts.
// The jobs that pass become "candidates" in the postings pool; the AI then scores them and adds the
// good ones to the board. Boards that need a browser are listed for the AI to search with its playbooks.

const path = require('path');
const paths = require('./paths');
const { writeJson, newId } = require('./fsx');
const profileLib = require('./profile');
const planLib = require('./plan');
const boardsLib = require('./boards');
const store = require('./store');
const postings = require('./postings');
const adtext = require('./adtext');
const { COLLECTORS } = require('./collectors');
const { makeGate } = require('./gate');
const { Stage, describe } = require('./funnel');
const { toIso, COUNTRIES, EU_EEA } = require('./countries');

function context(profile, target, plan, { pages = 2 } = {}) {
  const loc = target.location && target.location.city ? { ...profile.location, ...target.location } : profile.location;
  const iso = plan.country || toIso(loc.country) || '';
  return {
    scope: target.roles.scope,
    queries: plan.queries,
    title_keywords: plan.title_keywords || [],
    towns: plan.towns || [],
    companies: plan.companies || [],
    city: loc.city,
    country: iso,
    country_name: (COUNTRIES[iso] || [loc.country])[0],
    eu: EU_EEA.includes(iso),
    radius_km: Number(loc.radius_km) || 25,
    remote: profile.location.remote,
    job_types: target.job_types,
    days: plan.max_age_days || 14,
    pages,
  };
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

// Filter new rows and read their ad texts. Shared by the API search and by `hunt ingest` (browser results).
async function screen(rows, { profile, target, plan, run, maxReads = 80, log = () => {} }) {
  const gate = makeGate({ profile, target, plan, tickets: store.listTickets() });
  const seen = new Set();
  const unique = rows.filter((r) => {
    const k = postings.keyOf(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const up = postings.upsert(unique, { target: target.id, run });
  const fresh = up.filter((u) => u.isNew || u.item.status === 'new');
  const s1 = new Stage('new jobs', fresh.length);
  const passed = [];
  for (const u of fresh) {
    const r = { ...u.item, body: postings.readBody(u.key) };
    const why = gate(r);
    if (why) {
      s1.drop(why);
      postings.update(u.key, { status: 'dropped', reason: why });
    } else {
      s1.keep();
      passed.push(u);
    }
  }
  const s2 = new Stage('ad texts', passed.length);
  log(`Reading ${Math.min(passed.length, maxReads)} job ads…`);
  const reads = await mapLimit(passed, 4, async (u, i) => {
    if (i >= maxReads) return { ok: false, reason: 'not read (limit for one search)' };
    return adtext.read({ ...u.item, body: postings.readBody(u.key) });
  });
  const candidates = [];
  passed.forEach((u, i) => {
    const res = reads[i];
    if (res.ok) {
      s2.keep();
      postings.writeBody(u.key, res.text);
      const extra = res.extra || {};
      postings.update(u.key, { status: 'candidate', has_body: true, applicants: extra.applicants || undefined, salary: u.item.salary || extra.salary || undefined, job_type: u.item.job_type || extra.job_type || undefined });
      candidates.push(u.key);
    } else if (res.reason === 'ad_gone') {
      s2.drop('ad is gone');
      postings.update(u.key, { status: 'dropped', reason: 'ad is gone' });
    } else if (i >= maxReads) {
      // Over this search's reading limit: stays "new" and is read by the next search.
      s2.miss('left for the next search');
    } else {
      s2.miss(res.reason || 'unknown');
      // Unread is not a "no": the AI may open it in the browser.
      postings.update(u.key, { status: 'unread', reason: res.reason });
    }
  });
  return { stages: [s1.close(), s2.close()], candidates, already_known: up.length - fresh.length };
}

async function runSearch({ targetId, pages = 2, maxReads = 80, log = () => {} } = {}) {
  const profile = profileLib.loadProfile();
  const target = profile.targets.find((t) => t.id === targetId) || profile.targets.find((t) => t.active);
  if (!target) throw new Error('No active search target. Add one in Settings.');
  const plan = planLib.get(target.id);
  if (!plan) throw new Error(`There is no search plan for "${target.name}" yet. Use the plan-search skill first.`);
  const run = newId('search-');
  const ctx = context(profile, target, plan, { pages });
  const enabled = plan.boards.filter((b) => b.enabled).map((b) => boardsLib.get(b.id)).filter(Boolean);
  const apiBoards = enabled.filter((b) => b.access.kind === 'api');
  const browserBoards = enabled.filter((b) => b.access.kind === 'browser' || (b.access.playbook && b.access.kind !== 'api'));
  const coverage = {};
  const rows = [];
  for (const b of apiBoards) {
    log(`Searching ${b.name}…`);
    try {
      const res = await COLLECTORS[b.access.collector](ctx);
      coverage[b.id] = res.coverage;
      rows.push(...res.rows);
      // A board that blocked us is searched with the browser instead.
      if (res.blocked && b.access.playbook) browserBoards.push(b);
    } catch (err) {
      coverage[b.id] = [`error: ${String(err.message || err).slice(0, 200)}`];
    }
  }
  const result = await screen(rows, { profile, target, plan, run, maxReads, log });
  const report = {
    run, target: target.id, target_name: target.name, at: new Date().toISOString(), found: rows.length,
    already_known: result.already_known, stages: result.stages, candidates: result.candidates, coverage,
    browser_boards: browserBoards.map((b) => ({ id: b.id, name: b.name, url: b.url, playbook: `boards/playbooks/${b.access.playbook}.md` })),
  };
  writeJson(path.join(paths.runsDir(), 'searches', `${run}.json`), report);
  return report;
}

function summary(report) {
  const lines = [
    `Search "${report.target_name}" (${report.target}): ${report.found} jobs found on the API boards, ${report.already_known} seen before.`,
    describe(report.stages),
    `Candidates for you to score now: ${report.candidates.length}  →  node tools/hunt.js candidates --target ${report.target}`,
  ];
  if (report.browser_boards.length) {
    lines.push('Search these boards with the browser (follow each playbook), save the results as JSON and run');
    lines.push(`node tools/hunt.js ingest <file.json> --target ${report.target} --source <board id>:`);
    for (const b of report.browser_boards) lines.push(`  - ${b.id}: ${b.name} (${b.url})  playbook: ${b.playbook}`);
  }
  const problems = Object.entries(report.coverage).filter(([, c]) => c.some((x) => /not set up|error|limiting|does not cover/.test(x)));
  for (const [id, c] of problems) lines.push(`Note ${id}: ${c.find((x) => /not set up|error|limiting|does not cover/.test(x))}`);
  return lines.join('\n');
}

module.exports = { runSearch, screen, context, summary };
