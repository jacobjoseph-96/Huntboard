// Duplicate detection for job postings.
//  - linkKey: a stable id from the job link (Indeed jk, LinkedIn job id, StepStone/Xing ids, else the clean URL)
//  - nameKey: same title + company + town = same job posted on several boards

const TRACKING = /^(utm_|gclid|fbclid|mc_|ref$|refid$|trk|trackingid|src$|source$|from$|campaign)/i;

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Legal-form words that differ between boards for the same employer.
const COMPANY_NOISE = new Set([
  'gmbh', 'ag', 'kg', 'co', 'mbh', 'ug', 'se', 'ohg', 'gbr', 'ev', 'srl', 'spa', 'snc', 'sas', 'srls', 'sa', 'sl', 'sarl',
  'ltd', 'limited', 'llc', 'inc', 'corp', 'corporation', 'plc', 'bv', 'nv', 'oy', 'ab', 'as', 'aps', 'sp', 'zoo', 'the',
  'group', 'holding', 'company',
]);

function normalizeCompany(s) {
  return normalize(String(s || '').replace(/\b(\w)\.(?=\w\b|\w\.)/g, '$1').replace(/\./g, ''))
    .split(' ')
    .filter((w) => w && !COMPANY_NOISE.has(w))
    .join(' ');
}

// Gender / form-of-address markers that boards add to titles: (m/w/d), (f/m/x), (H/F), (M/F)...
function normalizeTitle(s) {
  return normalize(String(s || '').replace(/\(?\b[mwfdhx]\s*\/\s*[mwfdhx](\s*\/\s*[mwfdhx])?\b\)?/gi, ' '));
}

function cleanUrl(link) {
  const s = String(link || '').trim();
  if (!s) return '';
  try {
    const u = new URL(s);
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.toString().replace(/\/+$/, '').replace(/\?$/, '');
  } catch {
    return s.replace(/[#].*$/, '').replace(/\/+$/, '');
  }
}

function linkKey(link) {
  const s = String(link || '').trim();
  if (!s) return null;
  let m = s.match(/indeed\.[a-z.]+\/.*?[?&#](?:jk|vjk)=([0-9a-f]{8,})/i) || s.match(/[?&#](?:jk|vjk)=([0-9a-f]{12,})/i);
  if (m) return 'indeed:' + m[1].toLowerCase();
  m = s.match(/linkedin\.com\/.*?(?:jobs\/view\/(?:[^/?#]*-)?|currentJobId=|jobPosting[:/])(\d{6,})/i);
  if (m) return 'linkedin:' + m[1];
  m = s.match(/stepstone\.[a-z.]+\/.*?--(\d{6,})(?:-inline)?\.html/i);
  if (m) return 'stepstone:' + m[1];
  m = s.match(/xing\.com\/jobs\/[^?#]*?-(\d{6,})/i);
  if (m) return 'xing:' + m[1];
  m = s.match(/arbeitsagentur\.de\/jobsuche\/jobdetail\/([\w-]+)/i);
  if (m) return 'ba:' + m[1].toLowerCase();
  return 'url:' + cleanUrl(s).toLowerCase();
}

function nameKey(job) {
  const title = normalizeTitle(job.title);
  const company = normalizeCompany(job.company);
  if (!title || !company) return null;
  const town = normalize(job.location).split(' ')[0] || '';
  return [title, company, town].join('|');
}

// Index existing jobs; `check(job)` returns the key of the duplicate or null, `remember(job, id)` adds one.
function makeIndex(existing = [], idOf = (j) => j.key) {
  const seen = new Map();
  const remember = (job, id) => {
    const lk = linkKey(job.link);
    const nk = nameKey(job);
    if (lk) seen.set(lk, id);
    if (nk) seen.set(nk, id);
  };
  for (const j of existing) remember(j, idOf(j));
  const check = (job) => {
    const lk = linkKey(job.link);
    if (lk && seen.has(lk)) return seen.get(lk);
    const nk = nameKey(job);
    if (nk && seen.has(nk)) return seen.get(nk);
    return null;
  };
  return { check, remember };
}

module.exports = { normalize, normalizeCompany, normalizeTitle, cleanUrl, linkKey, nameKey, makeIndex };
