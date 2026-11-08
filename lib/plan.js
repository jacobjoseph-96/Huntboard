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

function uniqueCompanies(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((c) => ({
    name: String((c && c.name) || '').trim(), ats: c && c.ats ? String(c.ats) : '', slug: c && c.slug ? String(c.slug) : '',
    ...(c && c.found ? { found: String(c.found).slice(0, 120) } : {}),
  })).filter((c) => {
    if (!c.name) return false;
    const k = c.ats && c.slug ? `${c.ats}:${c.slug.toLowerCase()}` : `name:${c.name.toLowerCase()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
    // Career boards to read directly; `found` says how a board got here ("search 2026-11-08": a web search
    // of the ATS hosts, see lib/discover.js). One entry per board (ats + slug).
    companies: uniqueCompanies(p.companies).slice(0, 200),
    // The day `hunt discover add` last ran for this plan (the search skill searches the ATS hosts once a day).
    discovered_at: /^\d{4}-\d{2}-\d{2}$/.test(String(p.discovered_at || '')) ? String(p.discovered_at) : '',
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

// The time range a search keeps: ads posted in the last N days (1 = same day … 60 = two months).
const AGE_CHOICES = [1, 3, 7, 14, 30, 60];

function setMaxAge(targetId, days) {
  const n = Number(days);
  if (!AGE_CHOICES.includes(n)) throw new Error(`Choose one of: ${AGE_CHOICES.join(', ')} days.`);
  const all = loadAll();
  const p = all.targets[targetId];
  if (!p) throw new Error(`No search plan for ${targetId} yet.`);
  p.max_age_days = n;
  p.updated_at = nowIso();
  writeJson(file(), all);
  return p;
}

module.exports = { get, loadAll, set, normalize, toggleBoard, setMaxAge, AGE_CHOICES, file };
