// A quick first fit check in code, before the AI reads a job: does the title match, which of the user's skills
// does the ad name, does it ask for a language or level the user does not have, is it far more senior?
// It sorts the candidates (the AI reads the best first) and drops the ones that clearly do not fit, so the AI
// spends its tokens on real options. It is never the fit on a ticket: the AI scores that from the ad and the CV.
//
// prescore({ title, body }, { profile, cv, target, plan }) -> { score 0-100, matched: [], missing: [], title_match }

const { techNormalize } = require('./roles');

const FLOOR = 20; // below this nothing in the ad matches the user: skipped without asking the AI

const LANGS = {
  English: ['english', 'englisch', 'inglese', 'anglais', 'ingles', 'angielski', 'engels'],
  German: ['german', 'deutsch', 'deutschkenntnisse', 'tedesco', 'allemand', 'aleman', 'niemiecki', 'duits'],
  Italian: ['italian', 'italienisch', 'italiano', 'italien', 'wloski'],
  French: ['french', 'franzosisch', 'francese', 'francais', 'frances', 'francuski', 'frans'],
  Spanish: ['spanish', 'spanisch', 'spagnolo', 'espagnol', 'espanol', 'hiszpanski', 'spaans'],
  Polish: ['polish', 'polnisch', 'polacco', 'polonais', 'polski', 'pools'],
  Dutch: ['dutch', 'niederlandisch', 'olandese', 'neerlandais', 'nederlands', 'holenderski'],
  Portuguese: ['portuguese', 'portugiesisch', 'portoghese', 'portugais', 'portugues'],
};
// Words that make a language a requirement, and the level they mean (CEFR as a number: A1 = 1 … C2 = 6).
const STRONG = /\b(fluent|fluency|fliessend|verhandlungssicher|muttersprach\w*|native|c1|c2|excellent|exzellent|perfekt\w*|madrelingua|ottim\w*|courant|bilingue|parfait\w*|excelente|nativo|biegl\w*|proficien\w*|business level)\b/;
const GOOD = /\b(good|gute?n?|sehr gute?n?|b2|buon\w*|bonne?s?|buen\w*|dobr\w*|solid\w*|working knowledge|required|erforderlich|zwingend|richiest\w*|requis\w*|obligatori\w*|wymagan\w*)\b/;
const LEVEL = { a1: 1, a2: 2, b1: 3, b2: 4, c1: 5, c2: 6, native: 6, mother: 6, madrelingua: 6, muttersprache: 6, fluent: 5, business: 5, advanced: 5, good: 4, intermediate: 3, basic: 2, elementary: 2, beginner: 1 };
const LEVEL_NAME = ['', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

// The language an ad is written in, from its most common little words.
const STOP = {
  English: ['and', 'the', 'with', 'for', 'you', 'our', 'will'], German: ['und', 'der', 'die', 'mit', 'fur', 'wir', 'sie', 'ihre'],
  Italian: ['di', 'per', 'con', 'che', 'il', 'della', 'nel'], French: ['et', 'les', 'des', 'pour', 'avec', 'vous', 'nous'],
  Spanish: ['y', 'para', 'con', 'los', 'las', 'del', 'una'], Polish: ['i', 'w', 'z', 'na', 'dla', 'oraz', 'jest'],
  Dutch: ['en', 'het', 'van', 'een', 'voor', 'met', 'wij'], Portuguese: ['e', 'para', 'com', 'os', 'uma', 'do', 'na'],
};

const SENIOR = /\b(senior|sr|lead|principal|staff|head|director|architect|leiter\w*|responsabile|chef de projet)\b/;
const YEARS = /(\d{1,2})\s*\+?\s*(?:-\s*\d{1,2}\s*)?(?:years?|yrs|jahre\w*|anni|ans|anos|años|lat)\b/g;

function levelOf(text) {
  const t = String(text || '').toLowerCase();
  for (const [k, v] of Object.entries(LEVEL)) if (t.includes(k)) return v;
  return 3; // a language listed without a level: assume conversational
}

function userLanguages(profile, cv) {
  const out = {};
  for (const l of [...((profile.about && profile.about.languages) || []), ...((cv && cv.languages) || [])]) {
    const n = techNormalize(l && l.name);
    const lang = Object.keys(LANGS).find((k) => LANGS[k].some((w) => n.includes(w)) || n.includes(k.toLowerCase()));
    if (lang) out[lang] = Math.max(out[lang] || 0, levelOf(l.level));
  }
  return out;
}

function adLanguage(words) {
  let best = null;
  let most = 0;
  for (const [lang, stop] of Object.entries(STOP)) {
    const n = words.filter((w) => stop.includes(w)).length;
    if (n > most) { most = n; best = lang; }
  }
  return most >= 8 ? best : null;
}

// The skills, tools and certificates of the user, as words to look for in an ad.
function userTerms(cv) {
  if (!cv) return [];
  const raw = [];
  for (const g of cv.skills || []) {
    if (typeof g === 'string') raw.push(...g.split(/[,;·|]/));
    else raw.push(...(g.items || []).flatMap((i) => String(i).split(/[,;·|]/)));
  }
  for (const e of cv.experience || []) if (e.tech) raw.push(...String(e.tech).split(/[,;·|/]/));
  for (const c of cv.certificates || []) if (c.name) raw.push(c.name);
  const seen = new Set();
  return raw.map((s) => String(s).replace(/\b(basic|basics|grundkenntnisse|base|basi)\b/gi, '').replace(/\(.*?\)/g, '').trim())
    .filter((s) => s.length >= 2 && s.length <= 40)
    .map((s) => ({ label: s, norm: techNormalize(s) }))
    .filter((t) => t.norm && (t.norm.length >= 3 || /^(cpp|qt|go|r|c)$/.test(t.norm)) && !seen.has(t.norm) && seen.add(t.norm));
}

function yearsOfExperience(cv) {
  let months = 0;
  const now = new Date();
  for (const e of (cv && cv.experience) || []) {
    const s = /^(\d{4})(?:-(\d{2}))?/.exec(String(e.start || ''));
    if (!s) continue;
    const endRaw = String(e.end || '');
    const en = /^(\d{4})(?:-(\d{2}))?/.exec(endRaw);
    const end = en ? [+en[1], +(en[2] || 12)] : [now.getFullYear(), now.getMonth() + 1];
    months += Math.max(0, (end[0] - +s[1]) * 12 + (end[1] - +(s[2] || 1)) + 1);
  }
  return months / 12;
}

function titleScore(title, queries, scope) {
  if (scope === 'any') return 20;
  const t = ` ${techNormalize(title)} `;
  let best = 0;
  for (const q of queries) {
    const n = techNormalize(q);
    if (!n) continue;
    if (t.includes(` ${n} `)) return 40;
    const words = n.split(' ').filter((w) => w.length >= 3 || w === 'cpp');
    const hit = words.filter((w) => t.includes(` ${w}`)).length;
    if (words.length && hit === words.length) best = Math.max(best, 34);
    else if (hit >= 2) best = Math.max(best, 28);
    else if (hit === 1) best = Math.max(best, 14);
  }
  return best;
}

function prescore(job, { profile, cv, target, plan }) {
  const body = String(job.body || '');
  const text = ` ${techNormalize(`${job.title} ${body}`)} `;
  const queries = require('./plan').queriesFor(target, plan);
  const matched = [];
  const missing = [];
  const scope = target && target.roles ? target.roles.scope : 'cv';

  const tScore = titleScore(job.title, queries, scope);
  let score = 15 + tScore;

  for (const term of userTerms(cv)) {
    if (text.includes(` ${term.norm} `)) matched.push(term.label);
  }
  score += Math.min(36, matched.length * 6);

  // Languages the ad asks for, with the level.
  const mine = userLanguages(profile, cv);
  const plain = techNormalize(body);
  for (const [lang, names] of Object.entries(LANGS)) {
    for (const name of names) {
      const i = plain.indexOf(name);
      if (i < 0) continue;
      const near = plain.slice(Math.max(0, i - 70), i + name.length + 70);
      const need = STRONG.test(near) ? 5 : GOOD.test(near) ? 4 : 0;
      if (!need) continue;
      const have = mine[lang] || 0;
      if (!have) { score -= 25; missing.push(`${lang} (${LEVEL_NAME[need]}+)`); }
      else if (have + 1 < need) { score -= 12; missing.push(`${lang} ${LEVEL_NAME[need]} (you: ${LEVEL_NAME[have]})`); }
      break;
    }
  }
  // An ad written in a language the user does not speak at all usually needs it.
  const adLang = adLanguage(plain.split(' '));
  if (adLang && !mine[adLang] && !missing.some((m) => m.startsWith(adLang)) && Object.keys(mine).length) {
    score -= 15;
    missing.push(`${adLang} (the ad is written in it)`);
  }

  // Much more senior than the user asked for or has.
  const asked = queries.map((q) => techNormalize(q)).join(' ');
  if (SENIOR.test(techNormalize(job.title)) && !SENIOR.test(asked)) {
    score -= 12;
    missing.push('a senior / lead role');
  }
  let years = 0;
  for (const m of plain.matchAll(YEARS)) {
    const near = plain.slice(Math.max(0, m.index - 60), m.index + 70);
    // "The company has over 15 years of experience" is about the company, not a requirement.
    const before = plain.slice(Math.max(0, m.index - 22), m.index);
    if (/\b(has|have|had|over|since|for|seit|da oltre|depuis|desde)\s*$/.test(before) && !/\b(at least|minimum|min|mindestens|almeno|au moins|al menos)\s*$/.test(before)) continue;
    if (+m[1] <= 15 && /(experience|erfahrung|esperienz|experienc|doswiadczen|ervaring|work)/.test(near)) years = Math.max(years, +m[1]);
  }
  const have = yearsOfExperience(cv);
  if (years >= 3 && cv && (cv.experience || []).length && years > have + 1) {
    score -= 10;
    missing.push(`${years}+ years of experience (you: about ${Math.round(have)})`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), matched: matched.slice(0, 10), missing: missing.slice(0, 6), title_match: tScore };
}

// The part of an ad that says what the employer wants (for the short view the AI reads), at most `max` characters.
const REQ_HEAD = /(your profile|requirements|qualifications|what you bring|what you('ll)? need|what we('re)? looking for|who you are|about you|must have|skills|ihr profil|dein profil|anforderungen|das bringst du mit|was du mitbringst|qualifikation|requisiti|profilo|cosa cerchiamo|competenze|votre profil|profil recherch|comp[ée]tences|requisitos|perfil|buscamos|wymagania|nasze wymagania|oczekujemy|profiel|wat vragen wij)/i;
const OTHER_HEAD = /(we offer|what we offer|benefits|wir bieten|was wir bieten|unser angebot|offriamo|cosa offriamo|nous offrons|nous proposons|ofrecemos|oferujemy|about us|über uns|chi siamo|qui sommes|wat bieden wij|how to apply|bewerbung|apply now)/i;

function requirementsOf(text, max = 600) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const take = (list) => {
    let out = '';
    for (const l of list) {
      if (out.length + l.length + 3 > max) break;
      out += (out ? ' · ' : '') + l.replace(/^[-*•·]\s*/, '');
    }
    return out;
  };
  const start = lines.findIndex((l) => l.length < 80 && REQ_HEAD.test(l));
  if (start >= 0) {
    const part = [];
    for (const l of lines.slice(start + 1)) {
      if (l.length < 80 && OTHER_HEAD.test(l)) break;
      part.push(l);
    }
    if (part.length) return take(part);
  }
  const hints = lines.filter((l) => /(required|must|experience|years|knowledge|degree|kenntnisse|erfahrung|ausbildung|studium|esperienza|conoscenz|laurea|expérience|connaissance|diplôme|experiencia|conocimiento|doświadczenie|znajomość)/i.test(l));
  return hints.length ? take(hints) : String(text || '').replace(/\s+/g, ' ').slice(0, max);
}

// Two or three sentences that say what the job is (for the ticket), skipping the "title | company | town" header line.
function summaryOf(text, max = 320) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const bodyLines = lines[0] && lines[0].includes(' | ') ? lines.slice(1) : lines;
  const flat = bodyLines.join(' ').replace(/\s+/g, ' ');
  const sentences = flat.match(/[^.!?]+[.!?]+/g) || [flat];
  let out = '';
  for (const s of sentences) {
    if (out.length + s.length > max) break;
    out += s;
    if (out.length > max * 0.6) break;
  }
  return (out || flat.slice(0, max)).trim();
}

module.exports = { prescore, requirementsOf, summaryOf, FLOOR, userLanguages };
