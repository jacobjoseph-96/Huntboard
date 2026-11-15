// Makes generated CVs, letters and e-mails read like the user wrote them, and keeps them clean for applicant
// tracking systems (ATS):
// - clean(): removes invisible and unusual characters that AI text often carries (zero-width spaces, soft hyphens,
//   direction marks, odd spaces) and that ATS parsers trip over. Typographic quotes of the language stay.
// - lint(): a style check that lists the phrases and habits that make a text sound machine-written, so the AI
//   rewrites them in plain words. It is advice, not a fact error.
// Note: a statistical watermark (e.g. SynthID in Gemini's word choices) is not a character and cannot be removed by
// code. What helps is what this module asks for: the user's own words from their CV, concrete facts, varied
// sentences, and the user reading the text once and changing what does not sound like them.

const INVISIBLE = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\u3164\uFE00-\uFE0F\uFEFF\uFFA0]|\uDB40[\uDC00-\uDC7F]/g;
const ODD_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

function clean(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(INVISIBLE, '')
    // Zero-width (non-)joiners belong to Persian, Arabic and Indic words; elsewhere they are hidden marks.
    .replace(/[\u200C\u200D]/g, (m, at, s) => (/[\u0600-\u06FF\u0900-\u0DFF]/.test(s[at - 1] || '') ? m : ''))
    .replace(ODD_SPACE, ' ')
    .replace(/\s*\u2014\s*/g, ' \u2013 ') // em dash: a well-known tell; the spaced en dash is normal in European text
    .replace(/\u2026/g, '...')
    .replace(/[ \t]{2,}/g, ' ');
}

// Every string in a JSON value (a CV, a letter), cleaned.
function cleanDeep(v) {
  if (typeof v === 'string') return clean(v);
  if (Array.isArray(v)) return v.map(cleanDeep);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cleanDeep(x)]));
  return v;
}

// Phrases that read as generated, per language. Lower case; matched on word boundaries.
const CLICHES = {
  en: ['delve', 'leverage', 'leveraging', 'passionate', 'dynamic', 'seamless', 'seamlessly', 'robust', 'spearheaded', 'spearheading',
    'testament', 'tapestry', 'synergy', 'synergies', 'cutting-edge', 'state-of-the-art', 'fast-paced', 'ever-evolving', 'ever-changing',
    'results-driven', 'detail-oriented', 'go-getter', 'thrive', 'thrilled', 'excited to apply', 'i am writing to', 'i am excited',
    'i am confident that', 'proven track record', 'unwavering', 'meticulous', 'embark', 'realm',
    'elevate', 'holistic', 'paramount', 'pivotal', 'underscore', 'showcase', 'moreover', 'furthermore', 'additionally',
    'in conclusion', 'look no further', 'team player', 'hardworking', 'hard-working', 'self-starter', 'think outside the box'],
  de: ['hiermit bewerbe ich mich', 'mit großem interesse', 'mit grossem interesse', 'leidenschaft', 'leidenschaftlich', 'dynamisch',
    'teamplayer', 'hochmotiviert', 'des weiteren', 'nahtlos', 'innovativ',
    'zukunftsweisend', 'ganzheitlich', 'synergien', 'ich bin überzeugt', 'wertvollen beitrag'],
  it: ['con la presente', 'appassionato', 'appassionata', 'dinamico', 'dinamica', 'proattivo', 'proattiva', 'in conclusione',
    'sinergie', 'innovativo', 'all\'avanguardia', 'team player'],
  fr: ['passionné', 'passionnée', 'dynamique', 'en outre', 'synergie', 'innovant', 'je me permets de',
    'force de proposition'],
  es: ['apasionado', 'apasionada', 'dinámico', 'dinámica', 'proactivo', 'proactiva', 'asimismo', 'sinergia', 'innovador',
    'por medio de la presente'],
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function sentences(text) {
  return String(text).split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
}

// Style warnings for a text (or the strings of a CV/letter JSON). lang: 'en', 'de'… or empty for all languages.
function lint(input, lang = '') {
  const parts = typeof input === 'string' ? [input] : collect(input);
  const text = parts.join('\n');
  const low = text.toLowerCase();
  const out = [];
  const langs = lang && CLICHES[String(lang).slice(0, 2).toLowerCase()] ? ['en', String(lang).slice(0, 2).toLowerCase()] : Object.keys(CLICHES);
  const hits = new Set();
  for (const l of langs) {
    for (const p of CLICHES[l]) {
      if (new RegExp(`(^|[^\\p{L}])${esc(p)}($|[^\\p{L}])`, 'u').test(low)) hits.add(p);
    }
  }
  if (hits.size) out.push(`sounds generated: ${[...hits].map((h) => `"${h}"`).join(', ')}. Say the concrete thing instead, in plain words.`);
  if (/—/.test(text)) out.push('em dashes (—): use a comma, a full stop or " – " instead.');
  if (INVISIBLE.test(text)) out.push('invisible characters (zero-width spaces, soft hyphens…): they are removed when the document is made.');
  INVISIBLE.lastIndex = 0;
  const triples = (text.match(/\b\w+, \w+,? (and|und|e|et|y) \w+\b/gi) || []).length;
  if (triples >= 3) out.push(`${triples} lists of three ("X, Y and Z"): keep the one that matters, vary the rest.`);
  // Paragraphs of prose (letters, e-mails, the summary): sentences that all have the same length read as machine-made.
  const prose = parts.filter((p) => p.length > 160);
  const lens = prose.flatMap(sentences).map((s) => s.split(/\s+/).length);
  if (lens.length >= 5) {
    const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
    const sd = Math.sqrt(lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length);
    if (sd / mean < 0.25) out.push('the sentences all have about the same length: mix short sentences with longer ones.');
  }
  const openers = new Map();
  for (const s of prose.flatMap(sentences)) {
    const w = s.split(/\s+/)[0].toLowerCase();
    openers.set(w, (openers.get(w) || 0) + 1);
  }
  const rep = [...openers].filter(([w, n]) => n >= 3 && w.length > 1);
  if (rep.length) out.push(`many sentences start the same way (${rep.map(([w, n]) => `"${w}" ×${n}`).join(', ')}).`);
  return out;
}

function collect(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collect(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['language', 'lang', 'hide_sections', 'company', 'group'].includes(k)) collect(x, out);
  return out;
}

module.exports = { clean, cleanDeep, lint, CLICHES };
