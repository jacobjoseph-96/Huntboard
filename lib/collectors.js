// Job board APIs Huntboard reads itself (no browser). Each collector: run(ctx) → { rows, coverage }.
// A row: { source, native_id, title, company, location, posted, url, body, salary, job_type, remote }.
// The parse* functions are pure so they can be tested with recorded answers.

const { request, htmlToText, decodeEntities, sleep } = require('./http');
const env = require('./env');
const { normalize } = require('./dedupe');

const day = (v) => {
  if (v == null || v === '') return '';
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
};
const row = (r) => ({ title: '', company: '', location: '', posted: '', url: '', body: '', salary: '', job_type: '', remote: false, ...r, native_id: String(r.native_id || '') });
const kmToMiles = (km) => Math.max(5, Math.round((Number(km) || 25) * 0.621));

// Does a title match the plan's search words? (for APIs that cannot search by keyword)
function titleMatches(title, ctx) {
  if (ctx.scope === 'any') return true;
  const words = [...ctx.title_keywords, ...ctx.queries].flatMap((q) => normalize(q).split(' ')).filter((w) => w.length >= 3);
  if (!words.length) return true;
  const t = ` ${normalize(title)} `;
  return words.some((w) => t.includes(` ${w}`));
}

function nearby(location, ctx) {
  const l = normalize(location);
  if (!l) return true;
  if (/remote|anywhere|worldwide|home office|homeoffice|da remoto|teletrabajo|t[eé]l[eé]travail/.test(l)) return ctx.remote !== 'no';
  if (ctx.remote === 'only') return false;
  return ctx.towns.some((t) => l.includes(normalize(t))) || l.includes(normalize(ctx.city));
}

// ---- LinkedIn public job search (no login) --------------------------------------------------------
const LI_TYPES = { full_time: 'F', part_time: 'P', contract: 'C', temporary: 'T', internship: 'I', seasonal: 'T', mini_job: 'P', apprenticeship: 'I', freelance: 'C' };

function parseLinkedin(html) {
  const out = [];
  for (const li of String(html || '').split(/<li[\s>]/).slice(1)) {
    const id = (li.match(/urn:li:jobPosting:(\d+)/) || [])[1];
    if (!id) continue;
    const text = (re) => decodeEntities(((li.match(re) || [])[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    out.push(row({
      source: 'LinkedIn', native_id: id,
      title: text(/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/),
      company: text(/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/),
      location: text(/job-search-card__location[^>]*>([\s\S]*?)<\/span>/),
      posted: (li.match(/<time[^>]*datetime="([^"]+)"/) || [])[1] || '',
      salary: text(/job-search-card__salary-info[^>]*>([\s\S]*?)<\/span>/),
      url: `https://www.linkedin.com/jobs/view/${id}`,
    }));
  }
  return out;
}

async function linkedin(ctx) {
  const rows = [];
  const coverage = [];
  const jt = [...new Set(ctx.job_types.map((j) => LI_TYPES[j]).filter(Boolean))].join(',');
  for (const q of ctx.queries) {
    for (let start = 0; start < ctx.pages * 10; start += 10) {
      const u = new URL('https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search');
      u.searchParams.set('keywords', q);
      u.searchParams.set('location', [ctx.city, ctx.country_name].filter(Boolean).join(', '));
      u.searchParams.set('distance', String(kmToMiles(ctx.radius_km)));
      u.searchParams.set('f_TPR', `r${ctx.days * 86400}`);
      if (jt) u.searchParams.set('f_JT', jt);
      if (ctx.remote === 'only') u.searchParams.set('f_WT', '2');
      u.searchParams.set('start', String(start));
      const res = await request(u.toString(), { retries: 1 });
      if (res.status === 429) {
        coverage.push(`${q}: LinkedIn is limiting requests; search it with the browser instead (playbook linkedin)`);
        return { rows, coverage, blocked: true };
      }
      const found = res.status === 200 ? parseLinkedin(res.text) : [];
      rows.push(...found);
      coverage.push(`${q} @${start}: ${res.status} ${found.length} jobs`);
      if (found.length < 10) break;
      await sleep(1200);
    }
  }
  return { rows, coverage };
}

// ---- Bundesagentur für Arbeit (Germany) -------------------------------------------------------------
const BA_HEADERS = { 'x-api-key': 'jobboerse-jobsuche', accept: 'application/json, text/plain, */*' };

function parseBa(data) {
  return ((data && data.ergebnisliste) || []).map((x) => {
    const a = (((x.stellenlokationen || [])[0] || {}).adresse) || {};
    return row({
      source: 'Arbeitsagentur', native_id: x.referenznummer,
      title: x.stellenangebotsTitel || '', company: x.firma || '',
      location: [a.ort, a.region].filter(Boolean).join(' '),
      posted: day(x.datumErsteVeroeffentlichung),
      url: `https://www.arbeitsagentur.de/jobsuche/jobdetail/${x.referenznummer}`,
    });
  }).filter((r) => r.native_id);
}

async function arbeitsagentur(ctx) {
  const rows = [];
  const coverage = [];
  const days = [1, 7, 14, 28].find((d) => d >= ctx.days) || 28;
  const zeit = [...new Set(ctx.job_types.map((j) => ({ full_time: 'vz', part_time: 'tz', mini_job: 'mj' }[j])).filter(Boolean))];
  if (ctx.remote !== 'no') zeit.push('ho');
  const angebotsart = ctx.job_types.length === 1 && ctx.job_types[0] === 'apprenticeship' ? 4 : 1;
  for (const q of ctx.queries) {
    for (let page = 1; page <= ctx.pages; page++) {
      const u = new URL('https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs');
      u.searchParams.set('angebotsart', String(angebotsart));
      u.searchParams.set('was', q);
      u.searchParams.set('wo', ctx.city);
      u.searchParams.set('umkreis', String(Math.max(0, Math.round(ctx.radius_km))));
      u.searchParams.set('veroeffentlichtseit', String(days));
      if (zeit.length && ctx.scope !== 'cv_all_types') u.searchParams.set('arbeitszeit', zeit.join(';'));
      u.searchParams.set('page', String(page));
      u.searchParams.set('size', '100');
      u.searchParams.set('pav', 'false');
      const res = await request(u.toString(), { headers: BA_HEADERS, json: true });
      const found = parseBa(res.data);
      rows.push(...found);
      coverage.push(`${q} p${page}: ${res.status} ${found.length} jobs`);
      if (found.length < 100) break;
      await sleep(400);
    }
  }
  return { rows, coverage };
}

// ---- Arbeitnow (Germany, many English-speaking jobs) ---------------------------------------------------
function parseArbeitnow(data) {
  return ((data && data.data) || []).map((r) => row({
    source: 'Arbeitnow', native_id: r.slug, title: r.title || '', company: r.company_name || '',
    location: r.location || '', posted: day(r.created_at), url: r.url || '',
    body: htmlToText(r.description), remote: Boolean(r.remote), job_type: (r.job_types || []).join(', '),
  })).filter((r) => r.native_id);
}

async function arbeitnow(ctx) {
  const rows = [];
  const coverage = [];
  const cutoff = Date.now() - ctx.days * 86400000;
  for (let page = 1; page <= Math.max(3, ctx.pages * 3); page++) {
    const res = await request(`https://www.arbeitnow.com/api/job-board-api?page=${page}`, { json: true });
    const all = parseArbeitnow(res.data);
    const fresh = all.filter((r) => !r.posted || Date.parse(r.posted) >= cutoff - 86400000);
    const kept = fresh.filter((r) => titleMatches(r.title, ctx) && (r.remote ? ctx.remote !== 'no' : nearby(r.location, ctx)));
    rows.push(...kept);
    coverage.push(`page ${page}: ${res.status} ${all.length} jobs, ${kept.length} match`);
    if (!all.length || fresh.length < all.length) break;
    await sleep(800);
  }
  return { rows, coverage };
}

// ---- Adzuna (19 countries, free key) -------------------------------------------------------------------
const ADZUNA_COUNTRIES = ['at', 'au', 'be', 'br', 'ca', 'ch', 'de', 'es', 'fr', 'gb', 'in', 'it', 'mx', 'nl', 'nz', 'pl', 'sg', 'us', 'za'];

function parseAdzuna(data) {
  return ((data && data.results) || []).map((j) => row({
    source: 'Adzuna', native_id: j.id, title: htmlToText(j.title), company: (j.company || {}).display_name || '',
    location: (j.location || {}).display_name || '', posted: day(j.created), url: j.redirect_url || '',
    body: htmlToText(j.description), salary: j.salary_min ? `${Math.round(j.salary_min)}${j.salary_max ? `-${Math.round(j.salary_max)}` : ''}` : '',
    job_type: [j.contract_time, j.contract_type].filter(Boolean).join(', '),
  })).filter((r) => r.native_id);
}

async function adzuna(ctx) {
  const id = env.get('ADZUNA_APP_ID');
  const key = env.get('ADZUNA_APP_KEY');
  const cc = ctx.country.toLowerCase();
  if (!id || !key) return { rows: [], coverage: ['not set up: add ADZUNA_APP_ID and ADZUNA_APP_KEY to .env (free at developer.adzuna.com)'] };
  if (!ADZUNA_COUNTRIES.includes(cc)) return { rows: [], coverage: [`Adzuna does not cover ${ctx.country}`] };
  const rows = [];
  const coverage = [];
  const onlyPart = ctx.job_types.every((j) => ['part_time', 'mini_job', 'seasonal'].includes(j));
  const onlyFull = ctx.job_types.every((j) => j === 'full_time');
  for (const q of ctx.queries) {
    for (let page = 1; page <= ctx.pages; page++) {
      const u = new URL(`https://api.adzuna.com/v1/api/jobs/${cc}/search/${page}`);
      for (const [k, v] of Object.entries({ app_id: id, app_key: key, what: q, where: ctx.city, distance: Math.round(ctx.radius_km), max_days_old: ctx.days, results_per_page: 50, sort_by: 'date' })) u.searchParams.set(k, String(v));
      if (onlyPart) u.searchParams.set('part_time', '1');
      if (onlyFull) u.searchParams.set('full_time', '1');
      const res = await request(u.toString(), { json: true });
      const found = parseAdzuna(res.data);
      rows.push(...found);
      coverage.push(`${q} p${page}: ${res.status} ${found.length} jobs`);
      if (found.length < 50) break;
      await sleep(1000);
    }
  }
  return { rows, coverage };
}

// ---- Jooble (many countries, free key) --------------------------------------------------------------------
function parseJooble(data) {
  return ((data && data.jobs) || []).map((j) => row({
    source: 'Jooble', native_id: j.id, title: htmlToText(j.title), company: j.company || '', location: j.location || '',
    posted: day(j.updated), url: j.link || '', body: htmlToText(j.snippet), salary: j.salary || '', job_type: j.type || '',
  })).filter((r) => r.native_id);
}

async function jooble(ctx) {
  const key = env.get('JOOBLE_KEY');
  if (!key) return { rows: [], coverage: ['not set up: add JOOBLE_KEY to .env (free at jooble.org/api/about)'] };
  const host = ctx.country === 'US' ? 'jooble.org' : `${ctx.country.toLowerCase()}.jooble.org`;
  const rows = [];
  const coverage = [];
  const cutoff = new Date(Date.now() - ctx.days * 86400000).toISOString().slice(0, 10);
  for (const q of ctx.queries) {
    for (let page = 1; page <= ctx.pages; page++) {
      const res = await request(`https://${host}/api/${encodeURIComponent(key)}`, { method: 'POST', body: { keywords: q, location: ctx.city, radius: String(Math.round(ctx.radius_km)), page: String(page) }, json: true });
      const found = parseJooble(res.data).filter((r) => !r.posted || r.posted >= cutoff);
      rows.push(...found);
      coverage.push(`${q} p${page}: ${res.status} ${found.length} jobs`);
      if (found.length < 15) break;
      await sleep(800);
    }
  }
  return { rows, coverage };
}

// ---- EURES (EU / EEA public employment services) ------------------------------------------------------------
function parseEures(data) {
  return ((data && data.jvs) || []).map((j) => {
    const places = Object.values(j.locationMap || {}).flat().map((x) => (x && (x.cityName || x.name || x.city)) || '').filter(Boolean);
    return row({
      source: 'EURES', native_id: j.id, title: j.title || '', company: (j.employer && j.employer.name) || '',
      location: [...new Set(places)].join(', ') || Object.keys(j.locationMap || {}).join(', '),
      posted: day(Number(j.creationDate) || j.creationDate), url: `https://europa.eu/eures/portal/jv-se/jv-details/${encodeURIComponent(j.id)}?lang=en`,
      body: htmlToText(j.description),
    });
  }).filter((r) => r.native_id);
}

async function eures(ctx) {
  const rows = [];
  const coverage = [];
  for (const q of ctx.queries) {
    for (let page = 1; page <= ctx.pages; page++) {
      const body = {
        keywords: [{ keyword: q, specificSearchCode: ctx.scope === 'any' ? 'EVERYWHERE' : 'TITLE' }],
        publicationPeriod: ctx.days <= 7 ? 'LAST_WEEK' : 'LAST_MONTH',
        occupationUris: [], skillUris: [], requiredExperienceCodes: [], positionScheduleCodes: [], sectorCodes: [],
        educationAndQualificationLevelCodes: [], positionOfferingCodes: [], locationCodes: [ctx.country.toLowerCase()],
        euresFlagCodes: [], otherBenefitsCodes: [], requiredLanguages: [], resultsPerPage: 50, sortSearch: 'MOST_RECENT',
        page, minNumberPost: null, sessionId: 'huntboard',
      };
      const res = await request('https://europa.eu/eures/api/jv-searchengine/public/jv-search/search', { method: 'POST', body, headers: { accept: 'application/json' }, json: true });
      const found = parseEures(res.data).filter((r) => nearby(r.location, ctx));
      rows.push(...found);
      coverage.push(`${q} p${page}: ${res.status} ${found.length} jobs nearby`);
      if (!res.data || ((res.data.jvs || []).length < 50)) break;
      await sleep(800);
    }
  }
  return { rows, coverage };
}

// ---- Remote job boards -------------------------------------------------------------------------------------------
function parseRemotive(data) {
  return ((data && data.jobs) || []).map((j) => row({
    source: 'Remotive', native_id: j.id, title: j.title || '', company: j.company_name || '', location: `Remote (${j.candidate_required_location || 'anywhere'})`,
    posted: day(j.publication_date), url: j.url || '', body: htmlToText(j.description), salary: j.salary || '', job_type: j.job_type || '', remote: true,
  })).filter((r) => r.native_id);
}

function remoteAllowed(where, ctx) {
  const w = String(where || '').toLowerCase();
  return /worldwide|anywhere|global/.test(w) || w.includes(String(ctx.country_name || '').toLowerCase()) || (ctx.eu && /europe|emea|\beu\b/.test(w));
}

async function remotive(ctx) {
  const rows = [];
  const coverage = [];
  const cutoff = Date.now() - ctx.days * 86400000;
  for (const q of ctx.queries) {
    const res = await request(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=100`, { json: true });
    const found = parseRemotive(res.data).filter((r) => (!r.posted || Date.parse(r.posted) >= cutoff) && remoteAllowed(r.location, ctx));
    rows.push(...found);
    coverage.push(`${q}: ${res.status} ${found.length} jobs`);
    await sleep(800);
  }
  return { rows, coverage };
}

function parseRemoteok(data) {
  return (Array.isArray(data) ? data : []).filter((j) => j && j.id && j.position).map((j) => row({
    source: 'Remote OK', native_id: j.id, title: j.position, company: j.company || '', location: `Remote (${j.location || 'anywhere'})`,
    posted: day(j.date), url: j.url || `https://remoteok.com/remote-jobs/${j.id}`, body: htmlToText(j.description),
    salary: j.salary_min ? `${j.salary_min}-${j.salary_max || ''}` : '', remote: true, job_type: (j.tags || []).join(', '),
  }));
}

async function remoteok(ctx) {
  const res = await request('https://remoteok.com/api', { json: true });
  const cutoff = Date.now() - ctx.days * 86400000;
  const all = parseRemoteok(res.data);
  const rows = all.filter((r) => (!r.posted || Date.parse(r.posted) >= cutoff) && titleMatches(`${r.title} ${r.job_type}`, ctx) && remoteAllowed(r.location, ctx));
  return { rows, coverage: [`${res.status}: ${all.length} jobs, ${rows.length} match`] };
}

// ---- Company career pages (applicant tracking systems) -----------------------------------------------------------
const ATS = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
  smartrecruiters: (s) => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100`,
  recruitee: (s) => `https://${s}.recruitee.com/api/offers/`,
  personio: (s) => `https://${s}.jobs.personio.de/xml`,
};

function parseAts(ats, text, slug, company) {
  const base = { source: 'Career page' };
  if (ats === 'personio') {
    return [...String(text || '').matchAll(/<position>([\s\S]*?)<\/position>/g)].map((m) => {
      const tag = (t) => ((m[1].match(new RegExp(`<${t}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${t}>`)) || [])[1] || '').trim();
      return row({ ...base, native_id: `personio:${slug}:${tag('id')}`, title: tag('name'), company, location: tag('office'), url: `https://${slug}.jobs.personio.de/job/${tag('id')}`, posted: day(tag('createdAt')), body: htmlToText(tag('jobDescriptions')) });
    }).filter((r) => r.title);
  }
  let d;
  try {
    d = JSON.parse(text);
  } catch {
    return [];
  }
  const map = {
    greenhouse: () => (d.jobs || []).map((j) => ({ id: j.id, title: j.title, location: (j.location || {}).name, url: j.absolute_url, posted: j.first_published || j.updated_at, body: htmlToText(decodeEntities(j.content)) })),
    lever: () => (Array.isArray(d) ? d : []).map((j) => ({ id: j.id, title: j.text, location: (j.categories || {}).location, url: j.hostedUrl, posted: j.createdAt, body: j.descriptionPlain || htmlToText(j.description) })),
    ashby: () => (d.jobs || []).map((j) => ({ id: j.id, title: j.title, location: j.location, url: j.jobUrl, posted: j.publishedAt, body: j.descriptionPlain || htmlToText(j.descriptionHtml), remote: j.isRemote })),
    smartrecruiters: () => (d.content || []).map((j) => ({ id: j.id, title: j.name, location: [(j.location || {}).city, (j.location || {}).country].filter(Boolean).join(', '), url: `https://jobs.smartrecruiters.com/${slug}/${j.id}`, posted: j.releasedDate, body: '' })),
    recruitee: () => (d.offers || []).map((j) => ({ id: j.id, title: j.title, location: j.city || j.location, url: j.careers_url || j.url, posted: j.published_at, body: htmlToText(j.description) })),
  };
  return (map[ats] ? map[ats]() : []).map((j) => row({ ...base, native_id: `${ats}:${slug}:${j.id}`, title: j.title || '', company, location: j.location || '', url: j.url || '', posted: day(j.posted), body: j.body || '', remote: Boolean(j.remote) }));
}

function slugCandidates(name) {
  const words = String(name || '').toLowerCase().replace(/[&/,.]/g, ' ')
    .replace(/\b(gmbh|mbh|ag|se|kg|ohg|ug|inc|ltd|llc|plc|srl|spa|sa|sl|bv|nv|holding|group|gruppe|co|and|und|international)\b/g, ' ')
    .replace(/[^a-z0-9 -]/g, '').split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return [...new Set([words.join(''), words.join('-'), `${words.join('')}careers`])].filter((s) => s.length >= 3);
}

async function ats(ctx) {
  const rows = [];
  const coverage = [];
  for (const c of ctx.companies.slice(0, 30)) {
    const tries = c.ats && c.slug ? [[c.ats, c.slug]] : Object.keys(ATS).flatMap((a) => (c.slug ? [c.slug] : slugCandidates(c.name)).map((s) => [a, s]));
    let done = false;
    for (const [a, s] of tries) {
      const res = await request(ATS[a](s), { retries: 0, timeout: 15000 });
      if (res.status !== 200) continue;
      const found = parseAts(a, res.text, s, c.name);
      if (!found.length && !(c.ats && c.slug)) continue;
      const kept = found.filter((r) => titleMatches(r.title, ctx) && (r.remote ? ctx.remote !== 'no' : nearby(r.location, ctx)));
      rows.push(...kept);
      coverage.push(`${c.name}: ${a}/${s} ${found.length} jobs, ${kept.length} match`);
      done = true;
      break;
    }
    if (!done) coverage.push(`${c.name}: no public job list found (the AI can look at its career page in the browser)`);
  }
  return { rows, coverage };
}

const COLLECTORS = { linkedin_guest: linkedin, arbeitsagentur, arbeitnow, adzuna, jooble, eures, remotive, remoteok, ats };

module.exports = {
  COLLECTORS, titleMatches, nearby, slugCandidates,
  parseLinkedin, parseBa, parseArbeitnow, parseAdzuna, parseJooble, parseEures, parseRemotive, parseRemoteok, parseAts,
};
