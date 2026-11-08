// Company job boards found by a web search. Recruiters search the ATS hosts straight from a search
// engine ("site:jobs.ashbyhq.com" plus the job title in quotes), and companies often post there days
// before the big boards get the ad. The search only *names* boards: each URL is checked against the
// board's own API (it must list postings), and the jobs and their dates always come from that API.
// A board that answers joins the search plan's companies, and `hunt search run` reads it from then on.

const http = require('./http');
const { ATS, atsFromUrl, atsOrgName, parseAts } = require('./collectors');
const planLib = require('./plan');

const MAX_COMPANIES = 200;

// "Jobs at Isar Aerospace", "Mobileye jobs", "C++ Developer - Sonar - Lever", "Engineer | ACME GmbH".
const NOT_A_NAME = /\b(jobs?|stellen\w*|careers?|remote|engineer\w*|developer\w*|\w*entwickler\w*|apply|bewerb\w*|position|vacanc\w*|search|myworkdayjobs|workday|smartrecruiters|greenhouse|lever|ashby|personio|recruitee)\b|\+\+|[()/]|\.(?:com|de|io|co|net|org)\b/i;
const SEP = /\s+[|\-–]\s+/;

function plausible(s) {
  const c = String(s || '').trim().replace(/^[\s.,:;]+|[\s.,:;]+$/g, '');
  return c.length >= 2 && c.length <= 60 && !NOT_A_NAME.test(c) ? c : '';
}

function nameFromTitle(title) {
  let t = String(title || '').trim();
  for (let i = 0; i < 2; i++) t = t.replace(/\s*[|\-–]\s*(smartrecruiters|greenhouse|lever|ashby|personio|recruitee|workday)\s*$/i, '');
  let m = t.match(/^(.+?)\s+(?:jobs|careers|karriere|stellenangebote|job board)$/i);
  if (m && plausible(m[1])) return plausible(m[1]);
  m = t.match(/(?:\bjobs? at|\bcareers at|\bkarriere bei|\bjobs bei|\bapplication for .*? at|\bat|@|\bbei)\s+(.+)$/i);
  if (m && plausible(m[1].split(SEP)[0])) return plausible(m[1].split(SEP)[0]);
  const parts = t.split(SEP);
  if (parts.length > 1) for (const c of [parts[parts.length - 1], parts[0]]) if (plausible(c)) return plausible(c);
  return '';
}

// A JSON list of URLs or {url, title}, {urls: [...]}, or one URL per line.
function readUrls(text) {
  const s = String(text || '').trim();
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    data = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^https?:\/\//i.test(l));
  }
  if (data && !Array.isArray(data) && Array.isArray(data.urls)) data = data.urls;
  return (Array.isArray(data) ? data : [])
    .map((x) => (typeof x === 'string' ? { url: x, title: '' } : { url: String((x && x.url) || ''), title: String((x && x.title) || '') }))
    .filter((x) => x.url);
}

const titleCase = (s) => String(s).replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// One URL -> { ok, ats, slug, name, jobs } or { ok: false, url, reason }.
async function check({ url, title = '' }) {
  const b = atsFromUrl(url);
  if (!b || !ATS[b.ats]) return { ok: false, url, reason: 'not a company board Huntboard can read' };
  const res = await http.request(ATS[b.ats](b.slug), { retries: 1, timeout: 20000 });
  if (res.status !== 200) return { ok: false, url, ...b, reason: `the board answered ${res.status}` };
  const jobs = parseAts(b.ats, res.text, b.slug, '').length;
  if (!jobs) return { ok: false, url, ...b, reason: 'no postings on the board' };
  const org = atsOrgName(b.ats, res.text);
  const name = (org && org.toLowerCase() !== b.slug.toLowerCase() ? org : '') || nameFromTitle(title) || titleCase(b.slug);
  return { ok: true, url, ...b, name, jobs };
}

const key = (c) => `${c.ats}:${String(c.slug || '').toLowerCase()}`;

// Check the URLs and add the boards that answer to the plan of one search target.
async function addToPlan(targetId, items, { dryRun = false, date = new Date().toISOString().slice(0, 10), how = 'search' } = {}) {
  const plan = planLib.get(targetId);
  if (!plan) throw new Error(`There is no search plan for ${targetId} yet. Use the plan-search skill first.`);
  const companies = [...(plan.companies || [])];
  const have = new Set(companies.filter((c) => c.ats && c.slug).map(key));
  const names = new Set(companies.map((c) => c.name.toLowerCase()));
  const added = [];
  const skipped = [];
  const seen = new Set();
  for (const it of items) {
    const b = atsFromUrl(it.url);
    if (b && (have.has(key(b)) || seen.has(key(b)))) {
      if (!seen.has(key(b))) skipped.push({ url: it.url, reason: `${b.ats}/${b.slug} is already in the plan` });
      seen.add(key(b));
      continue;
    }
    if (b) seen.add(key(b));
    const r = await check(it);
    if (!r.ok) {
      skipped.push(r);
      continue;
    }
    if (names.has(r.name.toLowerCase())) {
      skipped.push({ url: it.url, reason: `${r.name} is already in the plan (on another board)` });
      continue;
    }
    if (companies.length >= MAX_COMPANIES) {
      skipped.push({ url: it.url, reason: `the plan already has ${MAX_COMPANIES} companies` });
      continue;
    }
    const c = { name: r.name, ats: r.ats, slug: r.slug, found: `${how} ${date}` };
    companies.push(c);
    names.add(r.name.toLowerCase());
    added.push({ ...c, jobs: r.jobs });
  }
  if (!dryRun) planLib.set(targetId, { ...plan, companies, discovered_at: date });
  return { added, skipped };
}

// Is a discovery search due for this plan today? Once a day is enough: boards rarely appear overnight.
function due(targetId, today = new Date().toISOString().slice(0, 10)) {
  const plan = planLib.get(targetId);
  if (!plan) return { due: false, why: 'no search plan yet' };
  if (plan.discovered_at === today) return { due: false, why: `searched today (${today})` };
  return { due: true, why: plan.discovered_at ? `last searched ${plan.discovered_at}` : 'never searched' };
}

module.exports = { addToPlan, check, due, readUrls, nameFromTitle, MAX_COMPANIES };
