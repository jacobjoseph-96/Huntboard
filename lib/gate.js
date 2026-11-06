// Hard filters before the AI looks at a job: things that are clear from the card alone.
// Each check returns a drop reason or null. The AI judges everything else (fit, language, hours...).

const { normalize, makeIndex, normalizeCompany } = require('./dedupe');
const { titleMatches, nearby } = require('./collectors');

const SUSPICIOUS = /\b(mlm|network marketing|multi.?level|pyramid|investi(re|mento) (iniziale|richiesto)|paid course|pay (a|the) fee|upfront fee|registration fee|quota di iscrizione|crypto trading|forex|get rich|guadagna da casa|earn \$?\d+ (a|per) day)\b/i;
const FULL_TIME_ONLY = /^(full.?time|vollzeit|tempo pieno|temps plein|jornada completa|pe[łl]ny etat)$/i;
const REJECTION_DAYS = 180;

function makeGate({ profile, target, plan, tickets, now = Date.now() }) {
  const index = makeIndex(tickets);
  const rejected = new Map();
  for (const t of tickets) {
    if (t.status === 'closed' && t.resolution === 'rejected') {
      const when = Date.parse((t.history.slice().reverse().find((h) => h.to === 'closed') || {}).at || t.updated_at || 0);
      if (now - when < REJECTION_DAYS * 86400000) rejected.set(normalizeCompany(t.company), t.key);
    }
  }
  const avoid = String(profile.about.avoid || '').split(/[,;\n]/).map((s) => normalize(s)).filter((s) => s.length >= 3);
  const exclude = (plan.exclude_keywords || []).map(normalize).filter(Boolean);
  const ctx = {
    scope: target.roles.scope,
    queries: plan.queries,
    title_keywords: plan.title_keywords || [],
    towns: plan.towns || [],
    city: (target.location && target.location.city) || profile.location.city,
    remote: profile.location.remote,
  };
  const maxAge = (plan.max_age_days || 14) * 86400000;
  const fullTimeWanted = target.job_types.includes('full_time');

  return function check(r) {
    const dup = index.check(r);
    if (dup) return `already on your board (${dup})`;
    const co = normalizeCompany(r.company);
    if (co && rejected.has(co)) return `company said no in the last ${REJECTION_DAYS / 30} months (${rejected.get(co)})`;
    if (r.posted && Date.parse(r.posted) && now - Date.parse(r.posted) > maxAge) return 'too old';
    if (!nearby(r.location, ctx) && !r.remote) return 'too far away';
    if (ctx.remote === 'only' && !r.remote && !/remote|home ?office|da remoto|teletrabajo/i.test(r.location)) return 'not remote';
    if (!fullTimeWanted && FULL_TIME_ONLY.test(String(r.job_type || '').trim())) return 'full-time only';
    const t = normalize(r.title);
    if (avoid.some((a) => t.includes(a))) return 'something you want to avoid';
    if (exclude.some((x) => t.includes(x))) return 'excluded by your search plan';
    if (SUSPICIOUS.test(`${r.title} ${String(r.body || '').slice(0, 2000)}`)) return 'looks like a scam or paid scheme';
    if (!titleMatches(r.title, ctx)) return 'other field';
    return null;
  };
}

module.exports = { makeGate, SUSPICIOUS };
