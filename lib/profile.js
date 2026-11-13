// The user's profile (who they are, what they look for, how to apply) and app settings.
// profile.json holds personal data and lives in workspace/ (gitignored).

const crypto = require('crypto');
const paths = require('./paths');
const { readJson, writeJson, clone } = require('./fsx');

const JOB_TYPES = [
  ['full_time', 'Full-time'],
  ['part_time', 'Part-time'],
  ['temporary', 'Temporary'],
  ['contract', 'Contract'],
  ['internship', 'Internship'],
  ['apprenticeship', 'Apprenticeship / trainee'],
  ['seasonal', 'Seasonal'],
  ['mini_job', 'Mini-job / side job'],
  ['freelance', 'Freelance'],
];

const ROLE_SCOPES = [
  ['cv', 'Jobs in my field (from my CV)'],
  ['any', 'Any job of this type, whatever the field'],
  ['custom', 'These roles:'],
];

const APPLY_MODES = [
  ['off', "Don't apply. Prepare documents and links only"],
  ['assist', 'Fill in the forms, I click Submit myself'],
  ['auto', 'Apply for me (I confirm the list once per run)'],
  ['full_auto', "Fully automatic: search, apply and decide for me while I'm away"],
];

// Modes in which the AI may press Submit.
const SUBMIT_MODES = ['auto', 'full_auto'];

const REMOTE = ['no', 'also', 'only'];

const DEFAULT_PROFILE = {
  version: 1,
  person: { name: '', email: '', phone: '', address: '', city: '', country: '', birth_date: '', nationality: '', links: [] },
  location: { city: '', country: '', radius_km: 25, relocate: false, relocate_where: '', remote: 'also' },
  about: {
    languages: [],
    work_permit: '',
    driving_licence: '',
    min_salary: '',
    start_date: '',
    avoid: '',
    notes: '',
  },
  targets: [
    { id: 't1', name: 'My search', job_types: ['full_time'], roles: { scope: 'cv', titles: [] }, location: null, min_salary: '', active: true },
  ],
  applying: {
    mode: 'assist',
    daily_cap: 10,
    min_fit: 70, // fully automatic: only jobs with at least this fit score are applied to
    proxy_wait_seconds: 60, // fully automatic: how long a question waits for the user before the AI decides
    attachments: 'country_default',
    answers: { notice_period: '', salary_expectation: '', availability: '', relocation: '', extra: '' },
  },
  suggested_roles: [],
  // How the CV looks: template = a design from templates/cv/ or "own" (workspace/profile/cv_design/);
  // photo = auto (as usual in the country of the job), always or never.
  cv: { template: 'classic', photo: 'auto' },
  documents_language: 'auto',
  reply_language: 'English',
};

const CV_PHOTO = ['auto', 'always', 'never'];

const DEFAULT_SETTINGS = {
  version: 1,
  port: 4317,
  token: '',
  onboarding_done: false,
  ai: { tool: '', model: '', auto_prepare_interviews: false, chat_sessions: {}, full_access: {} },
  followup_days: 10,
  browser: { mode: 'own_profile' },
};

function deepMerge(base, over) {
  if (Array.isArray(base) || Array.isArray(over)) return over === undefined ? clone(base) : clone(over);
  if (base && typeof base === 'object') {
    const out = clone(base);
    for (const [k, v] of Object.entries(over || {})) {
      out[k] = k in base && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && v && typeof v === 'object' && !Array.isArray(v)
        ? deepMerge(base[k], v)
        : clone(v);
    }
    return out;
  }
  return over === undefined ? base : over;
}

function loadProfile() {
  return deepMerge(DEFAULT_PROFILE, readJson(paths.profileFile(), {}));
}

function saveProfile(profile) {
  const p = deepMerge(DEFAULT_PROFILE, profile);
  p.targets = (p.targets || []).map((t, i) => normalizeTarget(t, i));
  const ids = new Set();
  for (const [i, t] of p.targets.entries()) {
    while (ids.has(t.id)) t.id = `t${i + 1 + ids.size}`;
    ids.add(t.id);
  }
  if (!p.targets.length) p.targets = clone(DEFAULT_PROFILE.targets);
  if (!APPLY_MODES.some(([m]) => m === p.applying.mode)) p.applying.mode = 'assist';
  p.applying.daily_cap = Math.max(1, Math.min(100, Number(p.applying.daily_cap) || 10));
  p.applying.min_fit = Math.max(0, Math.min(100, Number.isFinite(Number(p.applying.min_fit)) ? Number(p.applying.min_fit) : 70));
  p.applying.proxy_wait_seconds = Math.max(0, Math.min(3600, Number.isFinite(Number(p.applying.proxy_wait_seconds)) ? Number(p.applying.proxy_wait_seconds) : 60));
  if (!p.cv || typeof p.cv !== 'object' || Array.isArray(p.cv)) p.cv = clone(DEFAULT_PROFILE.cv);
  p.cv.template = String(p.cv.template || '').toLowerCase().replace(/[^a-z0-9_-]/g, '') || DEFAULT_PROFILE.cv.template;
  if (!CV_PHOTO.includes(p.cv.photo)) p.cv.photo = 'auto';
  writeJson(paths.profileFile(), p);
  return p;
}

function normalizeTarget(t, i) {
  const out = deepMerge(DEFAULT_PROFILE.targets[0], t || {});
  out.id = String((t && t.id) || `t${i + 1}`).replace(/[^\w-]/g, '') || `t${i + 1}`;
  out.job_types = (out.job_types || []).filter((j) => JOB_TYPES.some(([k]) => k === j));
  if (!out.job_types.length) out.job_types = ['full_time'];
  if (!ROLE_SCOPES.some(([k]) => k === out.roles.scope)) out.roles.scope = 'cv';
  out.roles.titles = (out.roles.titles || []).map((s) => String(s).trim()).filter(Boolean);
  out.name = String((t && t.name) || '').trim() || describeTarget(out);
  return out;
}

function describeTarget(t) {
  const types = t.job_types.map((j) => (JOB_TYPES.find(([k]) => k === j) || [j, j])[1]).join(' / ');
  const roles = t.roles.scope === 'any' ? 'any job' : t.roles.scope === 'custom' ? t.roles.titles.join(', ') || 'my roles' : 'my field';
  return `${types}: ${roles}`;
}

function loadSettings() {
  const s = deepMerge(DEFAULT_SETTINGS, readJson(paths.settingsFile(), {}));
  if (!s.token) {
    s.token = crypto.randomBytes(18).toString('base64url');
    writeJson(paths.settingsFile(), s);
  }
  return s;
}

function saveSettings(patch) {
  const s = deepMerge(loadSettings(), patch);
  writeJson(paths.settingsFile(), s);
  return s;
}

// What is still missing before a search makes sense.
function missing(profile, documents) {
  const out = [];
  if (!documents.some((d) => d.type === 'cv')) out.push('cv');
  if (!profile.location.city || !profile.location.country) out.push('location');
  if (!profile.targets.some((t) => t.active)) out.push('targets');
  return out;
}

module.exports = {
  JOB_TYPES, ROLE_SCOPES, APPLY_MODES, SUBMIT_MODES, REMOTE, CV_PHOTO, DEFAULT_PROFILE, DEFAULT_SETTINGS,
  loadProfile, saveProfile, loadSettings, saveSettings, describeTarget, missing, deepMerge,
};
