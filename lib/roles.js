// The names employers use for the same job. A search for "C++ developer" also looks for "C++ software engineer",
// "C++ programmer", "C++ Entwickler"... so an ad is not missed because it uses another word for the same role.
// Deterministic and small: the plan-search skill adds more (other fields, other languages); this is the safety net
// that works with every AI tool and with search plans made before a title was added.

const { normalize } = require('./dedupe');

// Software roles: the role word is swapped, the qualifier ("C++", "Embedded", "Frontend") is kept as the user wrote it.
const SOFTWARE_ROLES = ['software developer', 'software engineer', 'developer', 'engineer', 'programmer', 'coder',
  'softwareentwickler', 'software-entwickler', 'entwickler', 'programmierer', 'sviluppatore software', 'sviluppatore',
  'programmatore', 'développeur', 'developpeur', 'ingénieur logiciel', 'desarrollador', 'programador', 'programista',
  'ontwikkelaar'];
const SOFTWARE_VARIANTS = ['{q} developer', '{q} software developer', '{q} software engineer', '{q} engineer', '{q} programmer'];
// "Engineer" alone is not software (mechanical engineer): the qualifier must look like software then.
const TECH = /(c\+\+|c#|\.net|\bjava\b|javascript|typescript|python|\bgo\b|golang|rust|php|ruby|kotlin|swift|scala|\bqt\b|embedded|firmware|front.?end|back.?end|full.?stack|\bweb\b|mobile|android|\bios\b|devops|cloud|react|angular|\bvue\b|node|unity|unreal|\bgame|\bsap\b|salesforce|software|\bsql\b|\bplc\b|robotics|\bml\b|machine learning|\bai\b)/i;
// The same software job in the language of the job country.
const LOCAL = {
  de: ['{q} Entwickler', 'Softwareentwickler {q}'], it: ['Sviluppatore {q}', 'Sviluppatore software {q}'],
  fr: ['Développeur {q}', 'Ingénieur logiciel {q}'], es: ['Desarrollador {q}', 'Programador {q}'],
  pl: ['Programista {q}'], pt: ['Desenvolvedor {q}', 'Programador {q}'],
};
const COUNTRY_LANG = { DE: 'de', AT: 'de', CH: 'de', LI: 'de', LU: 'fr', IT: 'it', SM: 'it', FR: 'fr', BE: 'fr', MC: 'fr', ES: 'es', MX: 'es', AR: 'es', PL: 'pl', PT: 'pt', BR: 'pt' };

// Other common jobs with several names (English; the plan-search skill covers the local words).
const FAMILIES = [
  ['waiter', 'waitress', 'server', 'waiting staff'],
  ['cook', 'chef', 'line cook', 'commis chef'],
  ['kitchen porter', 'dishwasher', 'kitchen assistant'],
  ['sales assistant', 'retail assistant', 'shop assistant', 'store associate'],
  ['warehouse worker', 'warehouse operative', 'picker packer', 'warehouse associate'],
  ['receptionist', 'front desk agent', 'front office agent'],
  ['cleaner', 'cleaning operative', 'housekeeper'],
  ['delivery driver', 'courier', 'driver'],
  ['customer service representative', 'customer service agent', 'customer support agent', 'call centre agent'],
  ['data analyst', 'bi analyst', 'reporting analyst'],
  ['project manager', 'project lead'],
  ['nurse', 'registered nurse'],
  ['electrician', 'electrical technician'],
];

const MAX = 16;
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const fill = (tpl, q) => clean(tpl.replace('{q}', q));

// Splits "C++ Software Developer" into the qualifier ("C++") and the software role word; null when it is not one.
function softwareParts(title) {
  const t = clean(title);
  const low = t.toLowerCase();
  for (const role of SOFTWARE_ROLES) {
    const i = low.indexOf(role);
    if (i < 0) continue;
    const before = low[i - 1];
    const after = low[i + role.length];
    if ((before && /[\p{L}\d]/u.test(before)) || (after && /[\p{L}\d]/u.test(after))) continue;
    const q = clean(`${t.slice(0, i)} ${t.slice(i + role.length)}`.replace(/\s*[-–,/]\s*$/, '').replace(/^\s*[-–,/]\s*/, ''));
    const qualifier = q.replace(/\bsoftware\b/i, '').trim();
    if (role === 'engineer' || role === 'coder') {
      if (!TECH.test(t)) return null;
    }
    return { qualifier, role };
  }
  return null;
}

// titles: what the user or the plan wrote. country: ISO code of the job country (adds the local words).
function expandTitles(titles, { country = '' } = {}) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const v = clean(s);
    const k = normalize(v.replace(/c\+\+/gi, 'cpp').replace(/c#/gi, 'csharp'));
    if (!v || !k || seen.has(k) || out.length >= MAX) return;
    seen.add(k);
    out.push(v);
  };
  const list = (Array.isArray(titles) ? titles : [titles]).map(clean).filter(Boolean);
  list.forEach(add);
  const lang = COUNTRY_LANG[String(country || '').toUpperCase()];
  for (const t of list) {
    const sw = softwareParts(t);
    if (sw) {
      const q = sw.qualifier;
      if (q) {
        SOFTWARE_VARIANTS.forEach((v) => add(fill(v, q)));
        if (lang && LOCAL[lang]) LOCAL[lang].forEach((v) => add(fill(v, q)));
      } else {
        ['software developer', 'software engineer', 'programmer'].forEach(add);
        if (lang && LOCAL[lang]) LOCAL[lang].forEach((v) => add(fill(v, '')));
      }
      continue;
    }
    const low = t.toLowerCase();
    for (const fam of FAMILIES) {
      const hit = fam.find((n) => new RegExp(`(^|[^\\p{L}])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}])`, 'iu').test(low));
      if (!hit) continue;
      fam.forEach((n) => add(t.replace(new RegExp(hit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), n)));
      break;
    }
  }
  return out;
}

// Words for matching a job title: "C++" and "C#" would vanish in normalize(), so they become "cpp" and "csharp".
function techNormalize(s) {
  return normalize(String(s || '').replace(/ß/g, 'ss').replace(/c\s?\+\+/gi, ' cpp ').replace(/c#/gi, ' csharp ').replace(/f#/gi, ' fsharp ')
    .replace(/\.net\b/gi, ' dotnet ').replace(/node\.js/gi, ' nodejs '));
}

module.exports = { expandTitles, techNormalize, softwareParts };
