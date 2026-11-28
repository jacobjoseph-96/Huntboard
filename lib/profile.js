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
  // city = where the user lives (documents, distance); places = where to search (cities or regions such as
  // "Berlin", "Sachsen", "Nordrhein-Westfalen"). No places = around the city.
  location: { city: '', country: '', radius_km: 25, places: [], relocate: false, relocate_where: '', remote: 'also' },
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
    { id: 't1', name: '', job_types: ['full_time'], roles: { scope: 'cv', titles: [] }, location: null, min_salary: '', active: true },
  ],
  applying: {
    mode: 'assist',
    daily_cap: 10,
    min_fit: 70, // fully automatic: only jobs with at least this fit score are applied to
    proxy_wait_seconds: 60, // fully automatic: how long a question waits for the user before the AI decides
    attachments: 'country_default',
    // Which CV goes with an application: one tailored to each job, or the CV exactly as the user uploaded it.
    cv_choice: 'tailored',
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
const CV_CHOICES = ['tailored', 'original'];
const MAX_PLACES = 12;

// "Berlin, Leipzig; Sachsen" or ["Berlin", "Leipzig"] → ["Berlin", "Leipzig", "Sachsen"] (trimmed, no duplicates).
function splitPlaces(v) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[,;\n]/);
  const seen = new Set();
  return list.map((x) => String(x || '').trim().replace(/\s+/g, ' ')).filter((x) => {
    const k = x.toLowerCase();
    if (!x || seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, MAX_PLACES);
}

const DEFAULT_SETTINGS = {
  version: 1,
  port: 4317,
  token: '',
  onboarding_done: false,
  // economy: 'auto' (on for the AI tools with small free plans: Antigravity, Gemini), 'on' or 'off', see lib/economy.js.
  ai: { tool: '', model: '', auto_prepare_interviews: false, chat_sessions: {}, full_access: {}, economy: 'auto' },
  followup_days: 10,
  // choice: the browser the user picked (an id from lib/browser.js); '' = the first installed one.
  browser: { mode: 'own_profile', choice: '' },
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
  if (!CV_CHOICES.includes(p.applying.cv_choice)) p.applying.cv_choice = 'tailored';
  p.location.places = splitPlaces(p.location.places);
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
  if (out.location && typeof out.location === 'object') {
    // Older profiles have one city per search; it is the first place now.
    const places = splitPlaces(out.location.places && out.location.places.length ? out.location.places : out.location.city);
    const radius = Number(out.location.radius_km) || null;
    out.location = places.length || radius ? { city: places[0] || '', places, radius_km: radius } : null;
  } else out.location = null;
  // A search the user did not name gets a generated name, marked so the app shows it as a hint, not as text to delete.
  const given = String((t && t.name) || '').trim();
  const auto = !given || given === 'My search' || (t && t.name_auto && given === describeTarget({ ...out, name: '' }));
  out.name = auto ? describeTarget(out) : given;
  out.name_auto = Boolean(auto);
  return out;
}

function describeTarget(t) {
  const types = t.job_types.map((j) => (JOB_TYPES.find(([k]) => k === j) || [j, j])[1]).join(' / ');
  const roles = t.roles.scope === 'any' ? 'any job' : t.roles.scope === 'custom' ? t.roles.titles.join(', ') || 'my roles' : 'my field';
  return `${types}: ${roles}`;
}

// Older Settings pages saved the AI tab's fields at the top level instead of under "ai", so they never took effect.
const STRAY_AI_KEYS = ['tool', 'model', 'models', 'task_tiers', 'auto_prepare_interviews', 'full_access', 'economy'];

function loadSettings() {
  const raw = readJson(paths.settingsFile(), {});
  const stray = STRAY_AI_KEYS.filter((k) => k in raw);
  if (stray.length) {
    raw.ai = deepMerge(raw.ai || {}, Object.fromEntries(stray.map((k) => [k, raw[k]])));
    for (const k of stray) delete raw[k];
  }
  const s = deepMerge(DEFAULT_SETTINGS, raw);
  if (stray.length) writeJson(paths.settingsFile(), s);
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
  JOB_TYPES, ROLE_SCOPES, APPLY_MODES, SUBMIT_MODES, REMOTE, CV_PHOTO, CV_CHOICES, DEFAULT_PROFILE, DEFAULT_SETTINGS,
  loadProfile, saveProfile, loadSettings, saveSettings, describeTarget, missing, deepMerge, splitPlaces, normalizeTarget,
};
