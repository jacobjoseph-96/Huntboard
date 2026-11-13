// The structured CV (workspace/profile/cv.json) that every document is rendered from.

const path = require('path');
const paths = require('./paths');
const { readJson, writeJson, clone } = require('./fsx');

const file = () => path.join(paths.profileDir(), 'cv.json');

const LISTS = ['experience', 'education', 'certificates', 'languages', 'skills', 'references', 'other'];

const str = (v) => (v == null ? '' : String(v).trim());
const list = (v) => (Array.isArray(v) ? v : str(v) ? [str(v)] : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

// One shape for every CV, whoever wrote the JSON. Older files and other tools used other key names
// ("title" for the headline, "language" for a language's name, contact details at the top level, a skill
// group's items as one string): they are read as the same thing, so nothing prints half empty.
function normalize(cv) {
  if (!cv || typeof cv !== 'object' || Array.isArray(cv)) return cv;
  const out = clone(cv);
  if (!out.headline && out.title) out.headline = out.title;
  delete out.title;

  const contact = obj(out.contact);
  for (const k of ['email', 'phone', 'address', 'city', 'country']) {
    if (!contact[k] && typeof out[k] === 'string' && out[k]) contact[k] = out[k];
    delete out[k];
  }
  contact.links = [...new Set([...list(contact.links), ...list(out.links)].map(str).filter(Boolean))];
  delete out.links;
  // Short lines for the top of the CV, as the user's own CV has them ("Available immediately").
  contact.extra = list(contact.extra).map(str).filter(Boolean);
  out.contact = contact;

  if (Array.isArray(out.languages)) {
    out.languages = out.languages.map((l) => {
      if (typeof l === 'string') return { name: str(l), level: '' };
      const x = { ...obj(l), name: str(obj(l).name || obj(l).language || obj(l).label), level: str(obj(l).level || obj(l).text) };
      for (const k of ['language', 'label', 'text']) delete x[k];
      return x;
    });
  }
  if (Array.isArray(out.skills)) {
    out.skills = out.skills.map((g) => {
      if (typeof g === 'string') return g;
      const x = { ...obj(g), group: str(obj(g).group || obj(g).label), items: list(obj(g).items != null ? obj(g).items : obj(g).text).map(str).filter(Boolean) };
      for (const k of ['label', 'text']) delete x[k];
      return x;
    });
  }
  if (Array.isArray(out.experience)) {
    out.experience = out.experience.map((e) => ({ ...obj(e), tech: Array.isArray(obj(e).tech) ? obj(e).tech.map(str).filter(Boolean).join(' · ') : str(obj(e).tech) }));
  }
  if (Array.isArray(out.education)) {
    out.education = out.education.map((e) => {
      const x = { ...obj(e) };
      if (!x.note && x.notes) x.note = x.notes;
      delete x.notes;
      return x;
    });
  }
  if (Array.isArray(out.certificates)) {
    out.certificates = out.certificates.map((c) => {
      if (typeof c === 'string') return { name: str(c) };
      const x = { ...obj(c), name: str(obj(c).name || obj(c).label) };
      delete x.label;
      return x;
    });
  }
  return out;
}

function load() {
  const cv = readJson(file(), null);
  return cv ? normalize(cv) : cv;
}

function validate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return ['The CV must be a JSON object.'];
  const problems = [];
  for (const k of LISTS) if (k in input && !Array.isArray(input[k])) problems.push(`"${k}" must be a list.`);
  if (problems.length) return problems;
  const cv = normalize(input);
  if (!cv.name) problems.push('"name" is missing.');
  (cv.experience || []).forEach((e, i) => {
    if (!e.title && !e.company) problems.push(`experience[${i}] needs a title or company.`);
    if (e.bullets && !Array.isArray(e.bullets)) problems.push(`experience[${i}].bullets must be a list.`);
  });
  (cv.languages || []).forEach((l, i) => {
    if (!l.name) problems.push(`languages[${i}] needs a "name", for example { "name": "English", "level": "C1" }.`);
  });
  return problems;
}

function save(input) {
  const problems = validate(input);
  if (problems.length) throw new Error(`The CV was not saved:\n  - ${problems.join('\n  - ')}`);
  const clean = normalize(input);
  for (const k of LISTS) clean[k] = Array.isArray(clean[k]) ? clean[k] : [];
  clean.updated_at = new Date().toISOString();
  writeJson(file(), clean);
  return clean;
}

module.exports = { load, save, validate, normalize, file };
