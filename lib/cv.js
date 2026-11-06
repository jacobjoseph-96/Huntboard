// The structured CV (workspace/profile/cv.json) that every document is rendered from.

const path = require('path');
const paths = require('./paths');
const { readJson, writeJson } = require('./fsx');

const file = () => path.join(paths.profileDir(), 'cv.json');

const LISTS = ['experience', 'education', 'certificates', 'languages', 'skills', 'references', 'other'];

function load() {
  return readJson(file(), null);
}

function validate(cv) {
  const problems = [];
  if (!cv || typeof cv !== 'object' || Array.isArray(cv)) return ['The CV must be a JSON object.'];
  if (!cv.name) problems.push('"name" is missing.');
  for (const k of LISTS) if (k in cv && !Array.isArray(cv[k])) problems.push(`"${k}" must be a list.`);
  (Array.isArray(cv.experience) ? cv.experience : []).forEach((e, i) => {
    if (!e.title && !e.company) problems.push(`experience[${i}] needs a title or company.`);
    if (e.bullets && !Array.isArray(e.bullets)) problems.push(`experience[${i}].bullets must be a list.`);
  });
  return problems;
}

function save(cv) {
  const problems = validate(cv);
  if (problems.length) throw new Error(`The CV was not saved:\n  - ${problems.join('\n  - ')}`);
  const clean = { ...cv };
  for (const k of LISTS) clean[k] = Array.isArray(cv[k]) ? cv[k] : [];
  clean.updated_at = new Date().toISOString();
  writeJson(file(), clean);
  return clean;
}

module.exports = { load, save, validate, file };
