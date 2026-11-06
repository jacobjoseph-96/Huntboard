// Job board registry (boards/registry.json + the user's own boards in workspace/boards.custom.json)
// and the ranking that picks boards for a search target from country, field and job type.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { readJson, writeJson } = require('./fsx');
const { toIso, EU_EEA } = require('./countries');
const { JOB_TYPES } = require('./profile');
const env = require('./env');

const SECTORS = ['*', 'tech', 'hospitality', 'retail', 'logistics', 'healthcare', 'trades', 'office', 'education', 'public',
  'students', 'hourly', 'remote', 'startups', 'finance', 'engineering', 'creative', 'household'];
const KINDS = ['api', 'browser', 'manual'];
const COLLECTORS = ['linkedin_guest', 'adzuna', 'jooble', 'eures', 'ats', 'remotive', 'remoteok', 'arbeitsagentur', 'arbeitnow'];

const registryFile = () => path.join(paths.ROOT, 'boards', 'registry.json');
const customFile = () => paths.ws('boards.custom.json');

function load({ custom = true } = {}) {
  const base = readJson(registryFile(), { boards: [] }).boards.map((b) => ({ ...b, custom: false }));
  if (!custom) return base;
  const own = readJson(customFile(), { boards: [] }).boards.map((b) => ({ ...b, custom: true }));
  const ids = new Set(base.map((b) => b.id));
  return [...base, ...own.filter((b) => !ids.has(b.id))];
}

function get(id) {
  return load().find((b) => b.id === id) || null;
}

function validateBoard(b) {
  const p = [];
  const where = `board "${b && b.id}"`;
  if (!b || !/^[a-z0-9_]{2,40}$/.test(b.id || '')) p.push(`${where}: id must be lowercase letters, digits or _`);
  if (!b.name) p.push(`${where}: name is missing`);
  if (!Array.isArray(b.countries) || !b.countries.length || b.countries.some((c) => !['*', 'EU'].includes(c) && !/^[A-Z]{2}$/.test(c))) p.push(`${where}: countries must be ISO codes, "EU" or "*"`);
  if (!Array.isArray(b.sectors) || b.sectors.some((s) => !SECTORS.includes(s))) p.push(`${where}: unknown sector (use ${SECTORS.join(', ')})`);
  if (!Array.isArray(b.job_types) || b.job_types.some((j) => j !== '*' && !JOB_TYPES.some(([k]) => k === j))) p.push(`${where}: unknown job type`);
  if (!b.access || !KINDS.includes(b.access.kind)) p.push(`${where}: access.kind must be ${KINDS.join(', ')}`);
  if (b.access && b.access.kind === 'api' && !COLLECTORS.includes(b.access.collector)) p.push(`${where}: unknown collector "${b.access.collector}"`);
  if (b.access && b.access.playbook && !fs.existsSync(path.join(paths.ROOT, 'boards', 'playbooks', `${b.access.playbook}.md`))) p.push(`${where}: playbook boards/playbooks/${b.access.playbook}.md is missing`);
  if (b.access && b.access.kind === 'browser' && !b.access.playbook) p.push(`${where}: a browser board needs a playbook`);
  if (typeof b.priority !== 'number' || b.priority < 0 || b.priority > 10) p.push(`${where}: priority must be 0-10`);
  return p;
}

function validate() {
  const all = load();
  const problems = all.flatMap(validateBoard);
  const seen = new Set();
  for (const b of all) {
    if (seen.has(b.id)) problems.push(`duplicate board id "${b.id}"`);
    seen.add(b.id);
  }
  return problems;
}

// The user's own board (found by the AI for a country the registry covers badly).
function addCustom(b) {
  const board = { sectors: ['*'], job_types: ['*'], needs_login: false, apply: 'external', priority: 5, verified: false, ...b, access: b.access || { kind: 'browser', playbook: 'generic' } };
  const problems = validateBoard(board);
  if (problems.length) throw new Error(problems.join('\n'));
  const data = readJson(customFile(), { boards: [] });
  data.boards = [...data.boards.filter((x) => x.id !== board.id), board];
  writeJson(customFile(), data);
  return board;
}

// Rough field of work from the job titles the AI suggested from the CV.
const SECTOR_WORDS = {
  hospitality: /waiter|waitress|barista|bartender|barman|chef|cook|kitchen|hotel|reception|housekeep|cameri|cuoc|kellner|koch|küche|servizio|sala|camarer|serveu|restaura/i,
  retail: /shop|retail|cashier|sales assist|store|commess|cassier|verkäuf|kassier|dependient|vendeu|negozio/i,
  logistics: /warehouse|logist|picker|packer|driver|delivery|courier|forklift|magazzin|lager|fahrer|corriere|almac|chauffeur|entrepôt/i,
  healthcare: /nurse|care|pflege|infermier|medic|doctor|therap|enfermer|soignant|aide-soignant|healthcare/i,
  tech: /develop|software|engineer|programm|devops|data |data$|it support|sysadmin|entwickler|informatik|sviluppat|programmat|desarroll|web/i,
  education: /teacher|tutor|lehrer|insegnant|educat|profesor|professeur|nanny|childcare|erzieh/i,
  trades: /electric|plumb|mechanic|carpent|welder|elettric|idraul|meccanic|elektrik|handwerk|installat|técnico|maçon/i,
  office: /office|admin|secretar|assistant|clerk|receptionist|accountant|impiegat|segretar|büro|sachbearbeit|administrativ/i,
  engineering: /engineer|ingegner|ingenieur|technician|techniker|tecnico/i,
  creative: /design|graphic|video|photograph|content|copywrit|marketing/i,
};

function inferSectors(profile) {
  const text = [...(profile.suggested_roles || []), ...(profile.targets || []).flatMap((t) => t.roles.titles || [])].join(' | ');
  return Object.entries(SECTOR_WORDS).filter(([, re]) => re.test(text)).map(([s]) => s);
}

function coversCountry(board, iso) {
  if (!iso) return board.countries.includes('*');
  return board.countries.includes(iso) || board.countries.includes('*') || (board.countries.includes('EU') && EU_EEA.includes(iso));
}

const LOOSE_TYPES = ['part_time', 'mini_job', 'seasonal', 'temporary'];
const LOOSE_SECTORS = ['hourly', 'hospitality', 'retail', 'logistics', 'students', 'household'];

// Rank the boards for one search target. Returns [{ board, score, reasons, usable, missing_keys }].
function suggest(profile, target, plan = null) {
  const loc = target.location && target.location.city ? { ...profile.location, ...target.location } : profile.location;
  const iso = toIso(loc.country);
  const remote = profile.location.remote;
  const sectors = target.roles.scope === 'any' ? [] : inferSectors({ ...profile, targets: [target] });
  const out = [];
  for (const b of load()) {
    const reasons = [];
    let score = b.priority * 3;
    const remoteOnly = Boolean(b.remote_only);
    if (remoteOnly) {
      if (remote === 'no') continue;
      score += remote === 'only' ? 20 : 4;
      reasons.push('remote jobs');
    } else if (b.countries.includes(iso)) {
      score += 40;
      reasons.push(`made for ${iso}`);
    } else if (coversCountry(b, iso)) {
      score += b.countries.includes('*') ? 30 : 24;
      reasons.push('covers your country');
    } else {
      continue;
    }
    if (remote === 'only' && !remoteOnly && !b.sectors.includes('remote')) score -= 10;
    const typeOk = b.job_types.includes('*') || target.job_types.some((j) => b.job_types.includes(j));
    if (!typeOk) {
      score -= 25;
      reasons.push('not for this job type');
    }
    const looseTarget = target.job_types.some((j) => LOOSE_TYPES.includes(j)) || target.roles.scope === 'any';
    if (looseTarget && b.sectors.some((s) => LOOSE_SECTORS.includes(s))) {
      score += 14;
      reasons.push('part-time / side jobs');
    }
    if (sectors.length) {
      const hit = b.sectors.filter((s) => sectors.includes(s));
      if (hit.length) {
        score += 15;
        reasons.push(`field: ${hit.join(', ')}`);
      } else if (!b.sectors.includes('*')) {
        score -= 12;
      }
    }
    score += b.access.kind === 'api' ? 6 : b.access.kind === 'browser' ? 3 : 0;
    const missing = (b.access.key_env || []).filter((k) => !env.get(k));
    if (missing.length) {
      score -= 15;
      reasons.push(`needs a free key (${missing.join(', ')})`);
    }
    if (b.id === 'ats' && !((plan && plan.companies) || []).length) {
      score -= 30;
      reasons.push('only for named companies');
    }
    out.push({ board: b, score, reasons, usable: !missing.length, missing_keys: missing });
  }
  return out.sort((a, b) => b.score - a.score);
}

module.exports = { SECTORS, COLLECTORS, load, get, validate, validateBoard, addCustom, suggest, inferSectors, coversCountry };
