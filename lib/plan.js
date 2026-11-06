// The search plan per search target (workspace/profile/search_plan.json), written by the plan-search skill:
// which boards, which search words, which towns count as "near", optional companies for career pages.

const path = require('path');
const paths = require('./paths');
const { readJson, writeJson, nowIso } = require('./fsx');
const boards = require('./boards');

const file = () => path.join(paths.profileDir(), 'search_plan.json');

function loadAll() {
  return readJson(file(), { targets: {} });
}

function get(targetId) {
  return loadAll().targets[targetId] || null;
}

function clean(list, max = 60) {
  return [...new Set((Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean))].slice(0, max);
}

function normalize(p) {
  const known = new Set(boards.load().map((b) => b.id));
  const problems = [];
  const out = {
    country: String(p.country || '').toUpperCase().slice(0, 2),
    queries: clean(p.queries, 40),
    title_keywords: clean(p.title_keywords, 80),
    exclude_keywords: clean(p.exclude_keywords, 80),
    towns: clean(p.towns, 120),
    languages: clean(p.languages, 6),
    max_age_days: Math.max(1, Math.min(60, Number(p.max_age_days) || 14)),
    boards: [],
    companies: (Array.isArray(p.companies) ? p.companies : []).slice(0, 80).map((c) => ({
      name: String(c.name || '').trim(), ats: c.ats ? String(c.ats) : '', slug: c.slug ? String(c.slug) : '',
    })).filter((c) => c.name),
    notes: String(p.notes || '').slice(0, 2000),
    updated_at: nowIso(),
  };
  for (const b of Array.isArray(p.boards) ? p.boards : []) {
    const id = typeof b === 'string' ? b : b && b.id;
    if (!known.has(id)) {
      problems.push(`unknown board "${id}" (add it first with: hunt boards add ...)`);
      continue;
    }
    out.boards.push({ id, enabled: typeof b === 'object' && b.enabled === false ? false : true, why: typeof b === 'object' ? String(b.why || '').slice(0, 200) : '' });
  }
  if (!out.queries.length) problems.push('queries: give at least one search word');
  if (!out.boards.length) problems.push('boards: choose at least one board');
  return { plan: out, problems };
}

function set(targetId, p) {
  const { plan, problems } = normalize(p);
  if (problems.length) throw new Error(`The search plan was not saved:\n  - ${problems.join('\n  - ')}`);
  const all = loadAll();
  all.targets[targetId] = plan;
  writeJson(file(), all);
  return plan;
}

function toggleBoard(targetId, boardId, enabled) {
  const all = loadAll();
  const p = all.targets[targetId];
  if (!p) throw new Error(`No search plan for ${targetId} yet.`);
  const b = p.boards.find((x) => x.id === boardId);
  if (b) b.enabled = Boolean(enabled);
  else if (enabled) p.boards.push({ id: boardId, enabled: true, why: 'added by you' });
  writeJson(file(), all);
  return p;
}

module.exports = { get, loadAll, set, normalize, toggleBoard, file };
