// Tickets: one folder per job application under workspace/applications/.
//   JOB-0012-acme-waiter/
//     ticket.json      fields, status, fit, interview rounds, history
//     posting.md       full ad text, saved when the job is found (ads disappear)
//     docs/            tailored CV, cover letter, attachments, sent snapshot
//     interview/       preparation packs per interview round
// Every write goes through this module (atomic writes + a lock).

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { ensureDir, readJson, writeJson, writeAtomic, slugify, nowIso } = require('./fsx');
const { withLock } = require('./lock');
const dedupe = require('./dedupe');

const STATUSES = ['found', 'to_apply', 'applied', 'interview', 'offer', 'closed'];
const STATUS_LABELS = { found: 'Found', to_apply: 'To apply', applied: 'Applied', interview: 'Interview', offer: 'Offer', closed: 'Closed' };
const RESOLUTIONS = ['accepted', 'rejected', 'declined', 'withdrawn', 'dismissed', 'expired'];
const FUNNEL = ['found', 'to_apply', 'applied', 'interview', 'offer'];
const INTERVIEW_STAGES = [
  ['recruiter_call', 'Recruiter / agency call'],
  ['hr_screen', 'HR screening'],
  ['async_video', 'Recorded video / AI interview'],
  ['hiring_manager', 'Hiring manager / team lead'],
  ['technical', 'Technical / skills interview'],
  ['assignment', 'Assignment / test / take-home'],
  ['trial_shift', 'Trial shift / trial day'],
  ['panel', 'Panel / second round'],
  ['final_onsite', 'Final / on-site'],
  ['offer', 'Offer / negotiation'],
];

const FIELDS = ['title', 'company', 'location', 'mode', 'job_type', 'salary', 'link', 'source', 'posted', 'target', 'origin',
  'category', 'contact', 'deadline', 'summary', 'requirements'];

function keyNum(key) {
  const m = String(key || '').trim().match(/^(?:job-?)?0*(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function formatKey(n) {
  return `JOB-${n}`;
}

function dirPrefix(n) {
  return `JOB-${String(n).padStart(4, '0')}`;
}

function listDirs() {
  const base = paths.applications();
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^JOB-\d{4,}/.test(d.name))
    .map((d) => path.join(base, d.name));
}

function ticketDir(key) {
  const n = keyNum(key);
  if (n == null) return null;
  const prefix = dirPrefix(n);
  return listDirs().find((d) => {
    const name = path.basename(d);
    return name === prefix || name.startsWith(prefix + '-');
  }) || null;
}

function readTicketFile(dir) {
  const t = readJson(path.join(dir, 'ticket.json'));
  if (t) t._dir = dir;
  return t;
}

function getTicket(key) {
  const dir = ticketDir(key);
  if (!dir) return null;
  return readTicketFile(dir);
}

function mustGet(key) {
  const t = getTicket(key);
  if (!t) throw new Error(`No ticket ${key}. Run "node tools/hunt.js list" to see the tickets.`);
  return t;
}

function listTickets({ status, target, includeClosed = true } = {}) {
  const out = [];
  for (const dir of listDirs()) {
    const t = readTicketFile(dir);
    if (!t) continue;
    if (status && t.status !== status) continue;
    if (target && t.target !== target) continue;
    if (!includeClosed && t.status === 'closed') continue;
    out.push(t);
  }
  return out.sort((a, b) => keyNum(a.key) - keyNum(b.key));
}

function save(t) {
  const dir = t._dir;
  const copy = { ...t };
  delete copy._dir;
  copy.updated_at = nowIso();
  writeJson(path.join(dir, 'ticket.json'), copy);
  t.updated_at = copy.updated_at;
  return t;
}

function nextNumber() {
  const counterFile = path.join(paths.dataDir(), 'counter.json');
  const c = readJson(counterFile, { next: 1 });
  const fromDirs = listDirs().reduce((m, d) => Math.max(m, Number((path.basename(d).match(/^JOB-(\d+)/) || [])[1]) || 0), 0);
  const n = Math.max(c.next || 1, fromDirs + 1);
  writeJson(counterFile, { next: n + 1 });
  return n;
}

function cleanStr(v, max = 20000) {
  if (v == null) return '';
  return String(v).replace(/\r\n/g, '\n').trim().slice(0, max);
}

function cleanFit(fit) {
  if (!fit || typeof fit !== 'object') return null;
  const score = Number(fit.score);
  return {
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null,
    verdict: cleanStr(fit.verdict, 300),
    reasons: (fit.reasons || []).map((r) => cleanStr(r, 400)).filter(Boolean).slice(0, 12),
    red_flags: (fit.red_flags || []).map((r) => cleanStr(r, 400)).filter(Boolean).slice(0, 12),
    scored_with: cleanStr(fit.scored_with, 80),
  };
}

function historyEntry(type, by, extra = {}) {
  return { at: nowIso(), by: by || 'user', type, ...extra };
}

// Create tickets. Returns { added: [ticket], duplicates: [{job, key}], invalid: [job] }.
function addTickets(jobs, { by = 'agent', status = 'found' } = {}) {
  return withLock('store', () => {
    const existing = listTickets();
    const index = dedupe.makeIndex(existing);
    const added = [];
    const duplicates = [];
    const invalid = [];
    for (const raw of jobs) {
      if (!raw || !cleanStr(raw.title)) {
        invalid.push(raw);
        continue;
      }
      const dup = index.check(raw);
      if (dup) {
        duplicates.push({ job: raw, key: dup });
        continue;
      }
      const n = nextNumber();
      const key = formatKey(n);
      const dir = path.join(paths.applications(), `${dirPrefix(n)}-${slugify(`${raw.company || ''} ${raw.title}`, 48)}`);
      ensureDir(dir);
      const t = { key };
      for (const f of FIELDS) t[f] = cleanStr(raw[f], f === 'summary' || f === 'requirements' ? 4000 : 600);
      t.link = dedupe.cleanUrl(raw.link) || t.link;
      t.origin = t.origin || (by === 'user' ? 'manual' : 'agent');
      t.status = STATUSES.includes(raw.status) ? raw.status : status;
      t.resolution = t.status === 'closed' ? (RESOLUTIONS.includes(raw.resolution) ? raw.resolution : 'dismissed') : null;
      t.furthest_status = FUNNEL.includes(t.status) ? t.status : 'found';
      if (t.status === 'applied') t.applied_at = nowIso();
      t.fit = cleanFit(raw.fit);
      t.interview = { stage: '', rounds: [] };
      t.documents = {};
      t.apply = {};
      t.found_at = nowIso();
      t.created_at = t.found_at;
      t.history = [historyEntry('created', by, { to: t.status, text: raw.source ? `Found on ${raw.source}` : '' })];
      t._dir = dir;
      save(t);
      if (raw.posting) writeAtomic(path.join(dir, 'posting.md'), cleanStr(raw.posting, 200000) + '\n');
      index.remember(t, key);
      added.push(t);
    }
    return { added, duplicates, invalid };
  });
}

function update(key, mutate, { by = 'user' } = {}) {
  return withLock('store', () => {
    const t = mustGet(key);
    mutate(t, by);
    return save(t);
  });
}

function setFields(key, patch, { by = 'user' } = {}) {
  return update(key, (t) => {
    const changed = [];
    for (const [k, v] of Object.entries(patch || {})) {
      if (FIELDS.includes(k)) {
        t[k] = k === 'link' ? dedupe.cleanUrl(v) : cleanStr(v, 4000);
        changed.push(k);
      } else if (k === 'fit') {
        t.fit = cleanFit(v);
        changed.push('fit');
      } else if (['documents', 'apply'].includes(k) && v && typeof v === 'object') {
        t[k] = { ...(t[k] || {}), ...v };
        changed.push(k);
      } else if (k === 'next_action_at') {
        t.next_action_at = v ? cleanStr(v, 40) : null;
        changed.push(k);
      }
    }
    if (changed.length) t.history.push(historyEntry('updated', by, { text: `Changed ${changed.join(', ')}` }));
  }, { by });
}

function moveTicket(key, status, { by = 'user', resolution, interview, note } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`Unknown status "${status}". Use one of: ${STATUSES.join(', ')}`);
  return update(key, (t) => {
    const from = t.status;
    t.status = status;
    if (status === 'closed') {
      t.resolution = RESOLUTIONS.includes(resolution) ? resolution : t.resolution || 'dismissed';
    } else {
      t.resolution = null;
    }
    if (FUNNEL.indexOf(status) > FUNNEL.indexOf(t.furthest_status || 'found')) t.furthest_status = status;
    if (status === 'applied' && !t.applied_at) t.applied_at = nowIso();
    if (status === 'interview' && interview) addRound(t, interview, by);
    t.status_changed_at = nowIso();
    t.history.push(historyEntry('status', by, { from, to: status, resolution: t.resolution || undefined, text: cleanStr(note, 2000) || undefined }));
  }, { by });
}

function addRound(t, iv, by) {
  const stage = INTERVIEW_STAGES.some(([k]) => k === iv.stage) ? iv.stage : 'hr_screen';
  const round = {
    n: (t.interview.rounds || []).length + 1,
    stage,
    at: cleanStr(iv.at, 40),
    format: cleanStr(iv.format, 80),
    interviewers: (Array.isArray(iv.interviewers) ? iv.interviewers : String(iv.interviewers || '').split(/[,;\n]/))
      .map((s) => cleanStr(s, 200)).filter(Boolean),
    language: cleanStr(iv.language, 60),
    invitation: cleanStr(iv.invitation, 20000),
    prep_dir: null,
    debrief: null,
    created_at: nowIso(),
  };
  t.interview.rounds = [...(t.interview.rounds || []), round];
  t.interview.stage = stage;
  t.history.push(historyEntry('interview', by, { text: `Interview round ${round.n}: ${stageLabel(stage)}${round.at ? ' on ' + round.at : ''}` }));
  return round;
}

function addInterviewRound(key, iv, { by = 'user' } = {}) {
  return update(key, (t) => {
    if (t.status !== 'interview') {
      const from = t.status;
      t.status = 'interview';
      if (FUNNEL.indexOf('interview') > FUNNEL.indexOf(t.furthest_status || 'found')) t.furthest_status = 'interview';
      t.status_changed_at = nowIso();
      t.history.push(historyEntry('status', by, { from, to: 'interview' }));
    }
    addRound(t, iv, by);
  }, { by });
}

function updateRound(key, n, patch, { by = 'agent' } = {}) {
  return update(key, (t) => {
    const r = (t.interview.rounds || []).find((x) => x.n === Number(n)) || (t.interview.rounds || []).slice(-1)[0];
    if (!r) throw new Error(`${key} has no interview round yet.`);
    for (const k of ['at', 'format', 'language', 'prep_dir', 'debrief', 'outcome']) if (k in patch) r[k] = patch[k] == null ? null : cleanStr(patch[k], 4000);
    if (patch.stage && INTERVIEW_STAGES.some(([s]) => s === patch.stage)) r.stage = patch.stage;
    if (patch.interviewers) r.interviewers = [].concat(patch.interviewers).map((s) => cleanStr(s, 200)).filter(Boolean);
    t.interview.stage = (t.interview.rounds.slice(-1)[0] || {}).stage || '';
    t.history.push(historyEntry('interview', by, { text: `Round ${r.n} updated (${Object.keys(patch).join(', ')})` }));
  }, { by });
}

function addNote(key, text, { by = 'user' } = {}) {
  const body = cleanStr(text, 8000);
  if (!body) throw new Error('Empty note.');
  return update(key, (t) => {
    t.history.push(historyEntry('comment', by, { text: body }));
  }, { by });
}

// A plain history event, e.g. type "followup" (resets the follow-up reminder).
function addEvent(key, type, text, { by = 'agent' } = {}) {
  return update(key, (t) => {
    t.history.push(historyEntry(String(type).replace(/[^\w-]/g, '').slice(0, 30) || 'event', by, { text: cleanStr(text, 2000) }));
  }, { by });
}

// "Needs you": something only the user can do (robot check, login, a question the AI could not answer).
// text = null clears it.
function setNeeds(key, text, { by = 'agent' } = {}) {
  const body = text == null ? null : cleanStr(text, 1000);
  return update(key, (t) => {
    if (body) {
      t.needs = { text: body, at: nowIso(), by };
      t.history.push(historyEntry('needs', by, { text: `Needs you: ${body}` }));
    } else if (t.needs) {
      t.history.push(historyEntry('needs', by, { text: `Done: ${t.needs.text}` }));
      t.needs = null;
    }
  }, { by });
}

function readPosting(key) {
  const t = mustGet(key);
  const f = path.join(t._dir, 'posting.md');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
}

function writePosting(key, text, { by = 'agent' } = {}) {
  const t = mustGet(key);
  writeAtomic(path.join(t._dir, 'posting.md'), cleanStr(text, 200000) + '\n');
  return update(key, (tt) => tt.history.push(historyEntry('updated', by, { text: 'Saved the job ad text' })), { by });
}

// Files inside the ticket folder (docs/, interview/...), relative paths.
function listFiles(key) {
  const t = mustGet(key);
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.name !== 'ticket.json' && !e.name.endsWith('.tmp')) {
        const st = fs.statSync(path.join(dir, e.name));
        out.push({ path: r, size: st.size, modified: st.mtime.toISOString() });
      }
    }
  };
  walk(t._dir, '');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function stageLabel(stage) {
  return (INTERVIEW_STAGES.find(([k]) => k === stage) || [stage, stage || 'Interview'])[1];
}

function publicTicket(t) {
  if (!t) return t;
  const copy = { ...t };
  delete copy._dir;
  copy.folder = paths.rel(t._dir);
  return copy;
}

module.exports = {
  STATUSES, STATUS_LABELS, RESOLUTIONS, FUNNEL, INTERVIEW_STAGES, FIELDS,
  keyNum, formatKey, ticketDir, getTicket, mustGet, listTickets, addTickets, setFields, moveTicket,
  addInterviewRound, updateRound, addNote, addEvent, setNeeds, readPosting, writePosting, listFiles, stageLabel, publicTicket,
};
