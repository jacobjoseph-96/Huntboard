// Checks a generated CV or letter (JSON) against the user's own data: every number, year, percentage,
// level (B2, C1…) and acronym (HACCP, ISO…) must appear in the CV, the profile, the documents or the job ad.
// Anything else is listed as "check this" so the AI fixes it or asks the user.

const store = require('./store');
const cvLib = require('./cv');
const profileLib = require('./profile');
const documents = require('./documents');

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

function sources({ ticket } = {}) {
  const parts = [JSON.stringify(cvLib.load() || {}), JSON.stringify(profileLib.loadProfile())];
  for (const d of documents.list()) parts.push(documents.readText(d.id), d.title, d.issuer, d.date);
  if (ticket) {
    const t = store.getTicket(ticket);
    if (t) {
      parts.push(store.readPosting(t.key), JSON.stringify(store.publicTicket(t)));
    }
  }
  return norm(parts.join('\n')).replace(/(\d)[.,](\d{3})\b/g, '$1$2');
}

// Words that are fine anywhere (dates in a letter, common acronyms).
const ALWAYS_OK = new Set(['CV', 'PDF', 'EU', 'UE', 'GDPR', 'RODO', 'OK', 'IT', 'HR', 'USA', 'UK', 'CEO']);

function check(generated, { ticket } = {}) {
  const src = sources({ ticket });
  const text = strings(generated).join('\n');
  const today = new Date();
  const okYears = new Set([String(today.getFullYear()), String(today.getFullYear() + 1)]);
  const problems = [];
  for (const c of claims(text)) {
    if (ALWAYS_OK.has(c) || okYears.has(c)) continue;
    const plain = norm(c).replace(/(\d)[.,](\d{3})\b/g, '$1$2');
    const bare = plain.replace(/[%+]$/, '');
    if (src.includes(plain) || src.includes(bare)) continue;
    problems.push(c);
  }
  return problems;
}

module.exports = { check, claims };
