// Checks a generated CV, letter or e-mail against the user's own data, so the AI cannot invent facts:
// - every number, year, percentage, level (B2, C1…) and acronym (HACCP, ISO…) must appear in the user's data;
// - in a CV, the job ad does NOT count as a source: a skill or tool the ad asks for is not the user's skill
//   (only the CV's title may use the ad's words);
// - in a CV, every skill must use the user's own words, every employer must be one from the user's CV, and there
//   may not be more jobs, schools or certificates than the user really has.
// A letter or e-mail may quote the ad (its job title, its tools), so there the ad counts too.
// Anything else is listed as "check this": the AI removes it, or asks the user and records the answer as a note.

const store = require('./store');
const cvLib = require('./cv');
const profileLib = require('./profile');
const documents = require('./documents');
const { normalize, normalizeCompany } = require('./dedupe');

function strings(v, out = []) {
  if (v == null) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  else if (typeof v === 'number') out.push(String(v));
  return out;
}

const norm = (s) => String(s).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');

// Tokens worth checking: numbers (with units/percent), years, CEFR levels, acronyms.
function claims(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b\d+(?:[.,]\d+)?\s?(?:%|\+)?/g)) {
    const t = m[0].trim();
    if (/^\d$/.test(t)) continue; // single digits alone are too noisy; see the counted claims below
    out.add(t.replace(/\s/g, ''));
  }
  // "5 years", "3 stagioni", "2 Jahre"… : small numbers that claim experience.
  const UNITS = 'years?|yrs|anni|jahre?n?|ans|años|anos|jaar|lat|seasons?|stagioni|saisons?|temporadas?|months?|mesi|monate?n?|mois|meses|maanden|miesi[eę]cy';
  for (const m of text.matchAll(new RegExp(`\\b(\\d)\\+?\\s+(?:${UNITS})\\b`, 'gi'))) out.add(m[0].toLowerCase().replace(/\s+/g, ' '));
  for (const m of text.matchAll(/\b[A-C][12]\b/g)) out.add(m[0]);
  for (const m of text.matchAll(/\b[A-Z][A-Z0-9&+-]{1,}[A-Z0-9]\b/g)) if (!/^[A-C][12]$/.test(m[0])) out.add(m[0]);
  return [...out];
}

// What the user told us: CV, profile, documents, and on the ticket only the user's notes and instructions.
function userParts(ticket) {
  const parts = [JSON.stringify(cvLib.load() || {}), JSON.stringify(profileLib.loadProfile())];
  for (const d of documents.list()) parts.push(documents.readText(d.id), d.title, d.issuer, d.date);
  const t = ticket ? store.getTicket(ticket) : null;
  if (t) {
    for (const h of t.history || []) if (h.type === 'comment') parts.push(h.text);
    if (t.instructions && t.instructions.text) parts.push(t.instructions.text);
  }
  return { parts, t };
}

function flatten(parts) {
  return norm(parts.join('\n')).replace(/(\d)[.,](\d{3})\b/g, '$1$2');
}

function sources({ ticket, withAd = true } = {}) {
  const { parts, t } = userParts(ticket);
  if (t && withAd) parts.push(store.readPosting(t.key), JSON.stringify(store.publicTicket(t)));
  return flatten(parts);
}

// Words that are fine anywhere (dates in a letter, common acronyms).
const ALWAYS_OK = new Set(['CV', 'PDF', 'EU', 'UE', 'GDPR', 'RODO', 'OK', 'IT', 'HR', 'USA', 'UK', 'CEO']);

const CV_KEYS = ['summary', 'skills', 'experience', 'headline', 'education', 'certificates', 'hide_sections'];
const isCv = (g) => g && typeof g === 'object' && !Array.isArray(g) && !g.paragraphs && CV_KEYS.some((k) => k in g);
// A whole CV (e.g. a translated cv_de.json) rather than the changes for one job.
const isFullCv = (g) => isCv(g) && ('name' in g || 'contact' in g || 'education' in g);

function checkClaims(text, src) {
  const today = new Date();
  const okYears = new Set([String(today.getFullYear()), String(today.getFullYear() + 1)]);
  const out = [];
  for (const c of claims(text)) {
    if (ALWAYS_OK.has(c) || okYears.has(c)) continue;
    const plain = norm(c).replace(/(\d)[.,](\d{3})\b/g, '$1$2');
    const bare = plain.replace(/[%+]$/, '');
    if (src.includes(plain) || src.includes(bare)) continue;
    out.push(c);
  }
  return out;
}

// A skill passes when one of its real words (3+ letters, not filler) is in the user's own data.
const FILLER = new Set(['and', 'the', 'for', 'with', 'und', 'mit', 'der', 'die', 'das', 'von', 'per', 'con', 'del', 'della', 'des', 'les', 'pour', 'avec', 'y', 'de', 'basic', 'advanced', 'good', 'skills', 'knowledge', 'kenntnisse', 'gute', 'sehr']);
function skillOk(item, srcWords) {
  const words = normalize(item).split(' ').filter((w) => w.length >= 3 && !FILLER.has(w));
  if (!words.length) return true;
  return words.some((w) => srcWords.has(w) || [...srcWords].some((s) => s.length >= 5 && w.length >= 5 && (s.startsWith(w) || w.startsWith(s))));
}

function cvProblems(generated, ticket) {
  const own = cvLib.load() || {};
  const userSrc = sources({ ticket, withAd: false });
  const problems = [];
  // The title may name the ad's job; everything else must come from the user.
  const { title, headline, ...rest } = generated;
  problems.push(...checkClaims(strings(rest).join('\n'), userSrc));
  if (title || headline) problems.push(...checkClaims(strings([title, headline]).join('\n'), sources({ ticket })));

  const companies = new Set((own.experience || []).map((e) => normalizeCompany(e.company)).filter(Boolean));
  for (const e of Array.isArray(generated.experience) ? generated.experience : []) {
    const c = normalizeCompany(e && e.company);
    if (c && companies.size && !companies.has(c) && ![...companies].some((x) => x.includes(c) || c.includes(x))) problems.push(`employer "${e.company}" is not in the user's CV`);
  }
  if (!isFullCv(generated)) {
    const srcWords = new Set(normalize(userSrc).split(' '));
    for (const g of Array.isArray(generated.skills) ? generated.skills : []) {
      for (const item of (g && Array.isArray(g.items) ? g.items : [])) {
        if (!skillOk(item, srcWords)) problems.push(`skill "${item}" is not in the user's data (use the user's own words, or leave it out)`);
      }
    }
  } else {
    for (const k of ['experience', 'education', 'certificates']) {
      const mine = (own[k] || []).length;
      const theirs = Array.isArray(generated[k]) ? generated[k].length : 0;
      if (mine && theirs > mine) problems.push(`${k}: ${theirs} entries, the user's CV has ${mine}`);
    }
  }
  return [...new Set(problems)];
}

function check(generated, { ticket } = {}) {
  if (isCv(generated)) return cvProblems(generated, ticket);
  return [...new Set(checkClaims(strings(generated).join('\n'), sources({ ticket })))];
}

module.exports = { check, claims, isCv };
