#!/usr/bin/env node
// Huntboard command-line tool. The AI uses it to read and change Huntboard data; people can use it too.
// Run `node tools/hunt.js help` for the list of commands.

const fs = require('fs');
const path = require('path');
const http = require('http');
const store = require('../lib/store');
const profileLib = require('../lib/profile');
const documents = require('../lib/documents');
const cvLib = require('../lib/cv');
const inbox = require('../lib/inbox');
const paths = require('../lib/paths');

const HELP = `Huntboard: node tools/hunt.js <command>

Profile and documents
  profile [--json]                       show the profile
  profile set <path>=<value> ...         e.g. about.work_permit="EU citizen"  location.radius_km=30
  profile patch <file.json> [--only-empty]
  docs list [--json]                     the user's documents (CV, degrees, certificates, references...)
  docs text <id>                         extracted text of a document
  docs add <file> --type <type> [--title ..] [--issuer ..] [--date ..]
  docs extract [<id>]                    (re)extract text
  docs photo-from-cv                     take the photo out of the uploaded CV (PDF or Word) as the CV photo
  cv show [--json] | cv set <file.json>  structured CV used for all documents
  cv render [--ticket KEY] [--overrides f.json] [--lang it] [--template id] [--photo yes] [--birth-date] [--nationality] [--references]
  cv use-original --ticket KEY           send the user's own uploaded CV for this job, untouched (no tailoring)
  cv templates [--json]                  the CV designs (the user's choice is in the profile: cv.template)
  cv design init --from <id> | cv design check   the user's own design (workspace/profile/cv_design/)
  letter render <letter.json> --ticket KEY [--lang it]
  attachments build --ticket KEY [--docs id,id]   one PDF with certificates/references
  factcheck <file.json|file.txt> [--ticket KEY]   facts must be in the user's data (a CV: not from the ad); style hints
  email draft --ticket KEY [--to <addr>] --subject ".." --body-file f.txt   .eml draft with the documents
  sent <KEY> [--channel ..] [--confirmation ..]   freeze the documents that were sent
  pdf-md <file.md>                       Markdown to PDF (interview packs)

Tickets
  list [--status <s>] [--target <id>] [--json]
  show <KEY> [--json] [--posting]
  add <jobs.json> [--status found|to_apply]   create tickets from a JSON array (duplicates skipped; each job needs
                                         "link", the URL of the ad, or a "pool_key" from candidates)
  move <KEY> <status> [--resolution <r>] [--note "..."]
       statuses: ${store.STATUSES.join(', ')}; resolutions: ${store.RESOLUTIONS.join(', ')}
  interview <KEY> --stage <stage> [--at <ISO date>] [--format ..] [--interviewers "A, B"] [--language ..]
       stages: ${store.INTERVIEW_STAGES.map(([k]) => k).join(', ')}
  round <KEY> [<n>] <field>=<value> ...  update an interview round (prep_dir, debrief, at, outcome)
  set <KEY> <field>=<value> ...          fields: ${store.FIELDS.join(', ')}, fit (JSON), documents (JSON), apply (JSON)
  note <KEY> "text"                      add a comment
  followed-up <KEY> "how"               record a follow-up (resets the reminder)
  needs <KEY> "what the user must do"    put the job on the user's "Needs you" list (--done clears it)
  instruct <KEY> "what the AI should do"  the user's instructions for this job (--clear removes them)
  posting <KEY> <file.md>                save the full job ad text
  files <KEY>                            files in the ticket folder
  delete <KEY>                           take a job off the board (to workspace/trash/)
  restore [<KEY>]                        put a deleted job back (no key: list the deleted ones)

Job search
  boards list|suggest [--target t1]|validate|add <file.json>   job board registry; suggest ranks boards for a search
  plan show [--target t1] | plan set <file.json> --target t1 | plan board <t1> <board> on|off
  search run --target t1                 search the API boards of the plan, filter, read the ads
  discover due [--target t1]             is today's search of the company job hosts still to do?
  discover add <url...> | --file f [--target t1] [--dry-run]   company boards found by a web search
                                         (Greenhouse, Lever, Ashby, ...): checked, then added to the plan
  ingest <file.json> --target t1 --source <board>   add jobs you found with the browser
  candidates [--target t1] [--json] | candidates show <key> | candidates skip <key...> --reason ".."

Other
  decide "decision and reason" [--ticket KEY]   record a decision taken for the user (fully automatic mode)
  inbox [--json]                         what needs attention now
  ask "<question>" [--choices "A,B"] [--details ".."] [--ticket KEY] [--timeout <minutes>]
  export --xlsx [file.xlsx]              all tickets as a spreadsheet
  import --xlsx <file.xlsx>              import an old job list spreadsheet
  pdf <file.html> [out.pdf]              print HTML to PDF (A4), shows the page count
  update [--check]                       get the newest Huntboard; your data in workspace/ is kept (backup first)
`;

function fail(msg, code = 2) {
  console.error(`ERROR: ${msg}`);
  process.exit(code);
}

// Boolean flags that never take a value.
const FLAGS = new Set(['json', 'posting', 'only-empty', 'hook', 'xlsx', 'all', 'done', 'check', 'yes']);

// The fact check before a document is made: a CV or letter with invented facts is not rendered.
function factGate(generated, ticket, what) {
  const fc = require('../lib/factcheck');
  const problems = fc.check(generated, { ticket });
  if (!problems.length) return;
  fail(`The ${what} was NOT made: these are not in the user's data${fc.isCv(generated) ? ' (in a CV the job ad does not count: a skill the ad asks for is not the user\'s skill)' : ''}:
  - ${problems.join('\n  - ')}
Remove them, or use the user's own words. If you think the user really has it, ask (hunt ask) and, when they say yes,
record it with: node tools/hunt.js note ${ticket || '<KEY>'} "The user confirmed: ..." , then render again.`, 1);
}

function styleLines(generated, lang) {
  const hints = require('../lib/humanize').lint(generated, lang);
  return hints.length ? `Style (rewrite these so it sounds like the user, not like an AI):\n  - ${hints.join('\n  - ')}` : '';
}

function parse(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      pos.push(a);
      continue;
    }
    const [k, v] = a.slice(2).split(/=(.*)/s);
    if (v !== undefined) opt[k] = v;
    else if (FLAGS.has(k)) opt[k] = true;
    else if (i + 1 < argv.length) opt[k] = argv[++i];
    else opt[k] = true;
  }
  return { pos, opt };
}

function value(v) {
  const s = String(v);
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function assignments(list) {
  const out = [];
  for (const a of list) {
    const m = String(a).match(/^([\w.[\]-]+)=(.*)$/s);
    if (!m) fail(`Expected <field>=<value>, got "${a}"`);
    out.push([m[1], value(m[2])]);
  }
  return out;
}

function setPath(obj, dotted, v) {
  const parts = dotted.split('.');
  let o = obj;
  for (const p of parts.slice(0, -1)) {
    if (o[p] == null || typeof o[p] !== 'object') o[p] = {};
    o = o[p];
  }
  o[parts[parts.length - 1]] = v;
}

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && !v.length);
}

// Merge `patch` into `base`; with onlyEmpty, existing non-empty values are kept.
function mergeInto(base, patch, onlyEmpty) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      mergeInto(base[k], v, onlyEmpty);
    } else if (!onlyEmpty || isEmpty(base[k])) {
      base[k] = v;
    }
  }
  return base;
}

function readJsonFile(file) {
  if (!file) fail('Give a JSON file.');
  if (!fs.existsSync(file)) fail(`File not found: ${file}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  } catch (err) {
    fail(`${file} is not valid JSON: ${err.message}`);
  }
}

function line(t) {
  const fit = store.fitLabel(t.fit);
  const stage = t.status === 'interview' && t.interview.stage ? ` [${store.stageLabel(t.interview.stage)}]` : '';
  const status = store.STATUS_LABELS[t.status] + (t.resolution ? `/${t.resolution}` : '') + stage;
  return [t.key, status, fit, t.title, t.company, t.location, t.link].join(' | ');
}

function printTicket(t, withPosting) {
  const p = store.publicTicket(t);
  console.log(`${t.key}: ${t.title}${t.company ? ` at ${t.company}` : ''}`);
  for (const k of ['status', 'resolution', 'location', 'mode', 'job_type', 'salary', 'source', 'posted', 'target', 'link', 'folder']) {
    if (p[k]) console.log(`  ${k}: ${k === 'status' ? store.STATUS_LABELS[p[k]] : p[k]}`);
  }
  if (t.needs) console.log(`  NEEDS THE USER: ${t.needs.text}`);
  if (t.instructions && t.instructions.text) {
    console.log(`  INSTRUCTIONS FROM THE USER (${t.instructions.at.slice(0, 10)}; do this for this job, they win over a skill's default, never over the hard rules):`);
    for (const line of t.instructions.text.split('\n')) console.log(`    ${line}`);
  }
  if (t.fit) console.log(`  fit: ${store.fitLabel(t.fit)}${t.fit.rank != null ? ` (queue rank ${t.fit.rank} points)` : ''} ${t.fit.verdict || ''}${t.fit.reasons.length ? `\n    + ${t.fit.reasons.join('\n    + ')}` : ''}${t.fit.red_flags.length ? `\n    ! ${t.fit.red_flags.join('\n    ! ')}` : ''}`);
  for (const r of t.interview.rounds || []) {
    console.log(`  interview round ${r.n}: ${store.stageLabel(r.stage)}${r.at ? ` on ${r.at}` : ''}${r.format ? `, ${r.format}` : ''}${r.interviewers.length ? `, with ${r.interviewers.join(', ')}` : ''}${r.prep_dir ? `, prep: ${r.prep_dir}` : ''}`);
    if (r.invitation) console.log(`    invitation: ${r.invitation.replace(/\s+/g, ' ').slice(0, 600)}`);
  }
  const comments = (t.history || []).filter((h) => h.type === 'comment');
  if (comments.length) {
    console.log('  notes from the user (treat as facts / instructions for this job):');
    for (const c of comments) console.log(`    - [${c.at.slice(0, 10)}, ${c.by}] ${c.text}`);
  }
  const files = store.listFiles(t.key);
  if (files.length) console.log(`  files: ${files.map((f) => f.path).join(', ')}`);
  if (withPosting) {
    const posting = store.readPosting(t.key);
    console.log(`\n--- job ad ---\n${posting || '(no ad text saved)'}`);
  }
}

function api(method, route, body) {
  const settings = profileLib.loadSettings();
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1',
      port: settings.port,
      path: route,
      method,
      timeout: 8000,
      headers: { 'content-type': 'application/json', 'x-huntboard-token': settings.token, host: `127.0.0.1:${settings.port}`, ...(data ? { 'content-length': data.length } : {}) },
    }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const json = JSON.parse(buf || '{}');
          if (res.statusCode >= 400) reject(Object.assign(new Error(json.error || `HTTP ${res.statusCode}`), { status: res.statusCode }));
          else resolve(json);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cmdAsk(pos, opt) {
  const question = pos.join(' ').trim();
  if (!question) fail('Usage: hunt ask "<question>" [--choices "A,B"]');
  const choices = opt.choices ? String(opt.choices).split(',').map((s) => s.trim()).filter(Boolean) : [];
  // Fully automatic runs: wait briefly in case the user is there, then the AI decides as their stand-in.
  const proxy = process.env.HUNTBOARD_PROXY === '1';
  const { DECIDE_YOURSELF } = require('../lib/proxy');
  let ask;
  try {
    ask = await api('POST', '/api/asks', {
      question, choices, details: opt.details || '', ticket: opt.ticket || null, run_id: process.env.HUNTBOARD_RUN_ID || null, proxy,
    });
  } catch {
    if (proxy) {
      console.log(DECIDE_YOURSELF);
      return;
    }
    console.log(`ASK: The Huntboard app is not running, so ask the user this yourself in your chat and wait for the answer:\n${question}${choices.length ? `\nChoices: ${choices.join(' / ')}` : ''}`);
    process.exit(3);
  }
  const waitMs = proxy ? profileLib.loadProfile().applying.proxy_wait_seconds * 1000 : (Number(opt.timeout) || 30) * 60000;
  const deadline = Date.now() + waitMs;
  console.error(`Waiting for the user to answer in the app (question ${ask.id})...`);
  while (Date.now() < deadline) {
    await sleep(Math.min(2000, Math.max(200, deadline - Date.now())));
    let a;
    try {
      a = await api('GET', `/api/asks/${ask.id}`);
    } catch {
      continue; // app restarting: keep waiting
    }
    if (a.status === 'answered') {
      console.log(`ANSWER: ${a.answer}`);
      return;
    }
    if (a.status !== 'pending') {
      console.log(`NO ANSWER: the question was ${a.status}. Stop and summarise what is left to do.`);
      process.exit(4);
    }
  }
  if (proxy) {
    await api('POST', `/api/asks/${ask.id}/auto`).catch(() => {});
    console.log(DECIDE_YOURSELF);
    return;
  }
  console.log('NO ANSWER: the user did not answer in time. Stop and summarise what is left to do.');
  process.exit(4);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, opt } = parse(rest);

  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return;

    case 'profile': {
      const sub = pos[0];
      if (sub === 'set') {
        const p = profileLib.loadProfile();
        for (const [k, v] of assignments(pos.slice(1))) setPath(p, k, v);
        profileLib.saveProfile(p);
        console.log('Profile saved.');
        return;
      }
      if (sub === 'patch') {
        const patch = readJsonFile(pos[1]);
        const p = mergeInto(profileLib.loadProfile(), patch, Boolean(opt['only-empty']));
        profileLib.saveProfile(p);
        console.log(`Profile saved${opt['only-empty'] ? ' (existing values kept)' : ''}.`);
        return;
      }
      const p = profileLib.loadProfile();
      if (opt.json) return console.log(JSON.stringify(p, null, 2));
      const docs = documents.list();
      console.log(`Name: ${p.person.name || '-'} | Lives in: ${[p.location.city, p.location.country].filter(Boolean).join(', ') || '-'} | Radius: ${p.location.radius_km} km | Remote: ${p.location.remote} | Relocate: ${p.location.relocate ? p.location.relocate_where || 'yes' : 'no'}`);
      console.log(`Search in: ${p.location.places.length ? p.location.places.join('; ') : `around ${p.location.city || '-'}`} (cities or regions; each is searched)`);
      console.log(`Languages: ${p.about.languages.map((l) => `${l.name} ${l.level}`.trim()).join(', ') || '-'} | Work permit: ${p.about.work_permit || '-'} | Driving licence: ${p.about.driving_licence || '-'}`);
      console.log(`Min salary: ${p.about.min_salary || '-'} | Start: ${p.about.start_date || '-'} | Avoid: ${p.about.avoid || '-'}`);
      console.log('Search targets:');
      for (const t of p.targets) {
        console.log(`  ${t.id}${t.active ? '' : ' (off)'}: ${t.name} | types: ${t.job_types.join(', ')} | roles: ${t.roles.scope}${t.roles.titles.length ? ` (${t.roles.titles.join(', ')})` : ''}${t.location && t.location.places.length ? ` | search in: ${t.location.places.join('; ')}${t.location.radius_km ? ` + ${t.location.radius_km} km` : ''}` : ''}`);
      }
      console.log(`Suggested roles from CV: ${p.suggested_roles.join('; ') || '-'}`);
      console.log(`Applying: ${p.applying.mode} (daily cap ${p.applying.daily_cap}) | CV to send: ${p.applying.cv_choice === 'original' ? 'the user\'s own CV as uploaded (no tailoring: hunt cv use-original)' : 'tailored to each job'} | Documents language: ${p.documents_language} | Reply language: ${p.reply_language}`);
      console.log(`Documents: ${docs.length ? docs.map((d) => `${d.type}:${d.title}`).join(', ') : 'none'}`);
      const miss = profileLib.missing(p, docs);
      if (miss.length) console.log(`Missing: ${miss.join(', ')}`);
      return;
    }

    case 'docs': {
      const sub = pos[0] || 'list';
      if (sub === 'list') {
        const docs = documents.list();
        if (opt.json) return console.log(JSON.stringify(docs, null, 2));
        if (!docs.length) return console.log('No documents yet. The user uploads them on the Profile page.');
        for (const d of docs) {
          console.log(`${d.id} | ${documents.typeLabel(d.type)} | ${d.title}${d.issuer ? ` | ${d.issuer}` : ''}${d.date ? ` | ${d.date}` : ''} | text: ${d.text_status}${d.sensitive ? ' | SENSITIVE (never attach unless the user says so)' : ''} | file: workspace/documents/${d.file}`);
        }
        return;
      }
      if (sub === 'text') {
        const d = documents.get(pos[1]);
        if (!d) fail(`No document ${pos[1]}. Run "hunt docs list".`);
        const text = documents.readText(d.id);
        if (!text) return console.log(`(no text: ${d.text_status}. The file is workspace/documents/${d.file})`);
        return console.log(text);
      }
      if (sub === 'add') {
        if (!pos[1]) fail('Usage: hunt docs add <file> --type cv');
        const d = await documents.add({ srcPath: pos[1], type: opt.type, title: opt.title, issuer: opt.issuer, date: opt.date, language: opt.language });
        return console.log(`Added ${d.id} (${documents.typeLabel(d.type)}), text: ${d.text_status}`);
      }
      if (sub === 'photo-from-cv') {
        const d = await documents.photoFromCv();
        if (!d) fail('No photo found in the uploaded CV. The user can add one on the Profile page.', 1);
        return console.log(`CV photo taken from the CV: ${d.id} (workspace/documents/${d.file})`);
      }
      if (sub === 'extract') {
        const ids = pos[1] ? [pos[1]] : documents.list().map((d) => d.id);
        for (const id of ids) {
          const d = await documents.extract(id);
          console.log(`${id}: ${d.text_status}`);
        }
        return;
      }
      fail(`Unknown docs command "${sub}"`);
      return;
    }

    case 'cv': {
      if (pos[0] === 'templates') {
        const render = require('../lib/render');
        const list = render.templates();
        if (opt.json) return console.log(JSON.stringify(list, null, 2));
        const chosen = profileLib.loadProfile().cv.template;
        for (const t of list) {
          console.log(`${t.id}${t.id === chosen ? ' (chosen)' : ''} | ${t.name} | ${t.layout === 'sidebar' ? 'two columns' : 'one column'} | online forms: ${t.ats === 'safe' ? 'read it well' : 'may read it out of order'} | ${t.good_for}`);
        }
        if (!list.some((t) => t.own)) console.log('own | not made yet: the "cv-design" skill copies the look of the user\'s own CV');
        return;
      }
      if (pos[0] === 'design') {
        const render = require('../lib/render');
        if (pos[1] === 'init') {
          let dir;
          try {
            dir = render.initDesign(opt.from || render.DEFAULT_TEMPLATE);
          } catch (err) {
            fail(err.message);
          }
          return console.log(`Own design started from "${opt.from || render.DEFAULT_TEMPLATE}" in ${paths.rel(dir)}: edit design.css and design.json there, then run "hunt cv design check".`);
        }
        if (pos[1] === 'check') {
          if (!render.ownDesign()) fail('There is no own design yet. Run: node tools/hunt.js cv design init --from <template id>');
          let out;
          try {
            out = render.preview(render.OWN, { dir: render.designDir(), name: 'preview', profile: profileLib.loadProfile(), lang: opt.lang || 'en', png: true });
          } catch (err) {
            fail(err.message);
          }
          return console.log(`Preview: ${paths.rel(out.pdf)}\nPicture of page 1: ${paths.rel(out.png)}\nPages: ${out.pages}${out.sample ? '\n(Shown with the sample person: there is no structured CV yet.)' : ''}`);
        }
        fail('Usage: hunt cv design init --from <template id> | hunt cv design check [--lang en]');
      }
      if (pos[0] === 'use-original') {
        if (!opt.ticket) fail('Usage: hunt cv use-original --ticket JOB-12');
        let rel;
        try {
          rel = cvLib.useOriginal(opt.ticket);
        } catch (err) {
          fail(err.message);
        }
        return console.log(`The user's own CV is this job's CV now (not tailored): ${rel}`);
      }
      if (pos[0] === 'render') {
        const render = require('../lib/render');
        const clean = require('../lib/humanize').cleanDeep;
        // --cv: a full CV in another language (same format as cv.json), e.g. docs/cv_it.json.
        const cv = opt.cv ? clean(readJsonFile(opt.cv)) : cvLib.load();
        if (!cv) fail('No structured CV yet. Use the "setup" skill first.');
        if (opt.cv) factGate(cv, opt.ticket, 'CV');
        const cvProblems = cvLib.validate(cv);
        if (cvProblems.length) fail(`The CV file has problems:\n  - ${cvProblems.join('\n  - ')}`);
        const p = profileLib.loadProfile();
        const t = opt.ticket ? store.mustGet(opt.ticket) : null;
        const overrides = opt.overrides ? clean(readJsonFile(opt.overrides)) : {};
        if (opt.overrides) factGate(overrides, opt.ticket, 'CV');
        const merged = render.merge(cv, overrides);
        const lang = opt.lang || 'en';
        // The look: the user's chosen template, unless this call names one.
        if (opt.template && opt.template !== true && !render.templates().some((x) => x.id === opt.template)) {
          fail(`No template "${opt.template}". Choose one of: ${render.templates().map((x) => x.id).join(', ')}.`);
        }
        let tpl;
        try {
          tpl = render.template(opt.template && opt.template !== true ? opt.template : p.cv.template);
        } catch (err) {
          fail(err.message);
        }
        const wantPhoto = render.wantsPhoto(p, opt.photo);
        const photo = wantPhoto ? render.photoData() : null;
        const html = render.cvHtml(merged, p, { lang, photo, extras: render.defaultExtras(p, opt), template: tpl });
        const dir = t ? path.join(t._dir, 'docs') : paths.profileDir();
        const file = path.join(dir, `CV_${render.fileBase(merged.name || p.person.name)}_${render.locale(lang).code}.html`);
        const out = render.writeAndPrint(file, html);
        if (t) store.setFields(t.key, { documents: { cv: path.relative(t._dir, out.pdf).split(path.sep).join('/'), cv_source: 'tailored' } }, { by: 'agent' });
        return console.log(`CV: ${paths.rel(out.pdf)}\nPages: ${out.pages}${out.pages > 1 ? '  (more than one page: shorten it, e.g. fewer bullets or merge old jobs)' : ''}\nTemplate: ${tpl.id} | Photo: ${photo ? 'yes' : wantPhoto ? 'no (no photo uploaded: the user adds one on the Profile page)' : 'no'}`);
      }
      if (pos[0] === 'set') {
        cvLib.save(readJsonFile(pos[1]));
        return console.log(`CV saved to ${paths.rel(cvLib.file())}.`);
      }
      const cv = cvLib.load();
      if (!cv) return console.log('No structured CV yet. Use the "setup" skill to create it from the uploaded CV.');
      return console.log(JSON.stringify(cv, null, 2));
    }

    case 'list': {
      const list = store.listTickets({ status: opt.status, target: opt.target });
      if (opt.json) return console.log(JSON.stringify(list.map(store.publicTicket), null, 2));
      if (!list.length) return console.log('No tickets.');
      console.log('Key | Status | Fit | Job | Company | Location | Link');
      for (const t of list) console.log(line(t));
      console.log(`${list.length} ticket(s).`);
      return;
    }

    case 'show': {
      const t = store.mustGet(pos[0]);
      if (opt.json) return console.log(JSON.stringify({ ...store.publicTicket(t), posting: opt.posting ? store.readPosting(t.key) : undefined, files: store.listFiles(t.key) }, null, 2));
      printTicket(t, opt.posting);
      return;
    }

    case 'add': {
      let data = readJsonFile(pos[0]);
      if (data && Array.isArray(data.jobs)) data = data.jobs;
      if (!Array.isArray(data)) data = [data];
      // Jobs from a search: take missing fields and the full ad text from the postings pool.
      const postings = require('../lib/postings');
      const prof = profileLib.loadProfile();
      data = data.map((j) => {
        if (!j || !j.pool_key) return j;
        const item = postings.get(j.pool_key) || {};
        const merged = { ...item, ...j, link: j.link || item.url || '', posting: j.posting || postings.readBody(j.pool_key) };
        if (!merged.target && item.targets && item.targets.length) merged.target = item.targets[0];
        // Fully automatic: good enough jobs go straight to "To apply".
        if (prof.applying.mode === 'full_auto' && j.fit && Number(j.fit.score) >= prof.applying.min_fit && !j.status) merged.status = 'to_apply';
        return merged;
      });
      // A job the AI found must keep the link to its ad: without it the user cannot check or apply.
      const noLink = opt.by === 'user' ? [] : data.filter((j) => j && j.title && !require('../lib/dedupe').cleanUrl(j.link || j.url));
      data = data.filter((j) => !noLink.includes(j));
      const res = store.addTickets(data, { by: opt.by === 'user' ? 'user' : 'agent', status: opt.status === 'to_apply' ? 'to_apply' : 'found' });
      for (const t of res.added) {
        const src = data.find((j) => j && j.pool_key && (j.title === t.title));
        if (src) postings.update(src.pool_key, { status: 'ticket', ticket: t.key });
      }
      for (const d of res.duplicates) if (d.job && d.job.pool_key) postings.update(d.job.pool_key, { status: 'ticket', ticket: d.key });
      console.log(`Added ${res.added.length} ticket(s)${res.added.length ? `: ${res.added.map((t) => t.key).join(', ')}` : ''}.`);
      if (res.duplicates.length) console.log(`Skipped ${res.duplicates.length} duplicate(s):\n  - ${res.duplicates.map((d) => `"${d.job.title}" at ${d.job.company || '?'} (already ${d.key})`).join('\n  - ')}`);
      if (res.invalid.length) console.log(`Skipped ${res.invalid.length} entr${res.invalid.length > 1 ? 'ies' : 'y'} without a title.`);
      if (noLink.length) {
        console.log(`NOT added, no link to the ad: ${noLink.map((j) => `"${j.title}" at ${j.company || '?'}`).join('; ')}.
Add "link": the full URL of the ad as the board shows it (or the "pool_key" from candidates), then run add again with only these jobs.`);
        process.exitCode = 1;
      }
      return;
    }

    case 'instruct': {
      const key = pos[0];
      if (!key || (!pos[1] && !opt.clear)) fail('Usage: hunt instruct <KEY> "<what the AI should do for this job>" | --clear');
      const t = store.setInstructions(key, opt.clear ? null : pos.slice(1).join(' '), { by: 'user' });
      console.log(t.instructions ? `${t.key}: instructions saved.` : `${t.key}: instructions removed.`);
      return;
    }

    // Take a job off the board (folder to workspace/trash/, kept off by searches).
    case 'delete': {
      const key = pos[0];
      if (!key) fail('Usage: hunt delete <KEY> [--note ".."]');
      const t = store.mustGet(key);
      const rec = store.deleteTicket(t.key, { by: opt.by === 'agent' ? 'agent' : 'user', note: typeof opt.note === 'string' ? opt.note : '' });
      console.log(`${rec.key} (${rec.company}) deleted; folder in workspace/trash/${rec.folder}. Undo: hunt restore ${rec.key}`);
      return;
    }

    case 'restore': {
      if (!pos[0]) {
        const list = store.listDeleted();
        console.log(list.length ? list.map((d) => `${d.key}  ${d.company} · ${d.title}  (${d.at.slice(0, 10)})`).join('\n') : 'Nothing deleted.');
        return;
      }
      const t = store.restoreTicket(pos[0], { by: 'user' });
      console.log(`${t.key} is back on the board (${store.STATUS_LABELS[t.status]}).`);
      return;
    }

    case 'move': {
      const [key, status] = pos;
      if (!key || !status) fail('Usage: hunt move <KEY> <status>');
      const t = store.moveTicket(key, status, { by: opt.by === 'user' ? 'user' : 'agent', resolution: opt.resolution, note: opt.note });
      console.log(`${t.key} is now ${store.STATUS_LABELS[t.status]}${t.resolution ? ` (${t.resolution})` : ''}.`);
      return;
    }

    case 'interview': {
      const key = pos[0];
      if (!key || !opt.stage) fail('Usage: hunt interview <KEY> --stage <stage> [--at ..]');
      const t = store.addInterviewRound(key, { stage: opt.stage, at: opt.at, format: opt.format, interviewers: opt.interviewers, language: opt.language, invitation: opt.invitation }, { by: opt.by === 'user' ? 'user' : 'agent' });
      const r = t.interview.rounds.slice(-1)[0];
      console.log(`${t.key}: interview round ${r.n} (${store.stageLabel(r.stage)}) added.`);
      return;
    }

    case 'round': {
      const key = pos[0];
      let rest2 = pos.slice(1);
      let n = null;
      if (rest2[0] && /^\d+$/.test(rest2[0])) n = Number(rest2.shift());
      const t0 = store.mustGet(key);
      const last = (t0.interview.rounds || []).slice(-1)[0];
      const t = store.updateRound(key, n || (last && last.n), Object.fromEntries(assignments(rest2)));
      console.log(`${t.key}: round updated.`);
      return;
    }

    case 'set': {
      const key = pos[0];
      const patch = Object.fromEntries(assignments(pos.slice(1)));
      store.setFields(key, patch, { by: opt.by === 'user' ? 'user' : 'agent' });
      console.log(`${store.mustGet(key).key} updated.`);
      return;
    }

    case 'note': {
      const [key, ...words] = pos;
      store.addNote(key, words.join(' '), { by: opt.by === 'user' ? 'user' : 'agent' });
      console.log('Note added.');
      return;
    }

    case 'posting': {
      const [key, file] = pos;
      if (!file || !fs.existsSync(file)) fail('Usage: hunt posting <KEY> <file.md>');
      store.writePosting(key, fs.readFileSync(file, 'utf8'));
      console.log('Job ad saved.');
      return;
    }

    case 'files': {
      for (const f of store.listFiles(pos[0])) console.log(`${f.path} (${f.size} bytes)`);
      return;
    }

    case 'letter': {
      if (pos[0] !== 'render' || !pos[1] || !opt.ticket) fail('Usage: hunt letter render <letter.json> --ticket JOB-12 [--lang it]');
      const render = require('../lib/render');
      const t = store.mustGet(opt.ticket);
      const letter = require('../lib/humanize').cleanDeep(readJsonFile(pos[1]));
      factGate(letter, t.key, 'cover letter');
      const lang = opt.lang || letter.language || 'en';
      const file = path.join(t._dir, 'docs', `Cover_letter_${render.fileBase(t.company || 'company')}_${render.locale(lang).code}.html`);
      const out = render.writeAndPrint(file, render.letterHtml(letter, profileLib.loadProfile(), { lang }));
      fs.writeFileSync(path.join(t._dir, 'docs', 'cover_letter.json'), JSON.stringify(letter, null, 2));
      store.setFields(t.key, { documents: { cover_letter: path.relative(t._dir, out.pdf).split(path.sep).join('/') } }, { by: 'agent' });
      return console.log(`Cover letter: ${paths.rel(out.pdf)}\nPages: ${out.pages}${out.pages > 1 ? '  (more than one page: shorten it)' : ''}`);
    }

    case 'attachments': {
      if (pos[0] !== 'build' || !opt.ticket) fail('Usage: hunt attachments build --ticket JOB-12 [--docs <id,id>]');
      const att = require('../lib/attachments');
      const t = store.mustGet(opt.ticket);
      const p = profileLib.loadProfile();
      const plan = require('../lib/plan').get(t.target || '') || {};
      const docs = att.choose({ setting: p.applying.attachments, country: plan.country || p.location.country, ids: opt.docs ? String(opt.docs).split(',') : null });
      if (!docs.length) return console.log('No attachments for this application (CV and letter only). Use --docs <id,id> to choose documents.');
      const res = await att.build(docs, path.join(t._dir, 'docs', 'Attachments.pdf'));
      if (res.file) store.setFields(t.key, { documents: { attachments: 'docs/Attachments.pdf' } }, { by: 'agent' });
      return console.log(`Attachments: ${res.file ? paths.rel(res.file) : 'none'} (${res.pages} pages: ${docs.map((d) => d.title).join(', ')})${res.skipped.length ? `\nLeft out: ${res.skipped.join('; ')}` : ''}${res.warning ? `\nWarning: ${res.warning}` : ''}`);
    }

    case 'factcheck': {
      if (!pos[0] || !fs.existsSync(pos[0])) fail('Usage: hunt factcheck <file.json|file.txt> [--ticket KEY] [--lang de]');
      // A JSON document (CV changes, letter) or the plain text of an e-mail.
      const generated = /\.json$/i.test(pos[0]) ? readJsonFile(pos[0]) : fs.readFileSync(pos[0], 'utf8');
      const fc = require('../lib/factcheck');
      const problems = fc.check(generated, { ticket: opt.ticket });
      const style = styleLines(generated, opt.lang || (generated && generated.language) || '');
      if (!problems.length) {
        console.log(`Fact check OK: every number, level, acronym${fc.isCv(generated) ? ', skill and employer' : ''} is in the user's data${fc.isCv(generated) ? '' : ' or the job ad'}.`);
        if (style) console.log(style);
        return;
      }
      console.log(`Check these, they are not in the user's CV, profile, documents or notes${fc.isCv(generated) ? ' (in a CV the job ad does not count)' : ' or the job ad'}:\n  - ${problems.join('\n  - ')}\nRemove them or ask the user (hunt ask) before you go on.`);
      if (style) console.log(style);
      process.exit(1);
      return;
    }

    case 'email': {
      if (pos[0] !== 'draft' || !opt.ticket || !opt['body-file']) fail('Usage: hunt email draft --ticket JOB-12 [--to jobs@company.com] --subject "…" --body-file body.txt');
      if (opt.to === true) opt.to = '';
      const t = store.mustGet(opt.ticket);
      const p = profileLib.loadProfile();
      const files = ['cv', 'cover_letter', 'attachments'].map((k) => t.documents && t.documents[k]).filter(Boolean).map((r) => path.join(t._dir, r)).filter((f) => fs.existsSync(f));
      const body = require('../lib/humanize').clean(fs.readFileSync(opt['body-file'], 'utf8'));
      const subject = opt.subject && opt.subject !== true ? opt.subject : t.title;
      const eml = require('../lib/eml').build({ from: p.person.email ? `${p.person.name} <${p.person.email}>` : p.person.name, to: opt.to || '', subject, body, attachments: files });
      const out = path.join(t._dir, 'docs', 'Application_email.eml');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, eml);
      // The same text to copy into a web mail or a contact form.
      fs.writeFileSync(path.join(t._dir, 'docs', 'Application_email.txt'), `${opt.to ? `To: ${opt.to}
` : ''}Subject: ${subject}

${body.trim()}
`);
      store.setFields(t.key, { documents: { email_draft: 'docs/Application_email.eml' }, apply: { route: 'email', ...(opt.to ? { to: opt.to } : {}) } }, { by: 'agent' });
      return console.log(`E-mail draft with ${files.length} attachment(s): ${paths.rel(out)} (text to copy: docs/Application_email.txt).${opt.to ? '' : ' No address yet: the user fills in "To".'} The user opens it, checks it and presses Send.`);
    }

    case 'sent': {
      // Freeze exactly what was sent with an application.
      const t = store.mustGet(pos[0]);
      const stamp = new Date().toISOString().slice(0, 10);
      const dir = path.join(t._dir, 'docs', `sent-${stamp}`);
      fs.mkdirSync(dir, { recursive: true });
      const copied = [];
      for (const k of ['cv', 'cover_letter', 'attachments', 'email_draft']) {
        const rel = t.documents && t.documents[k];
        if (rel && fs.existsSync(path.join(t._dir, rel))) {
          fs.copyFileSync(path.join(t._dir, rel), path.join(dir, path.basename(rel)));
          copied.push(path.basename(rel));
        }
      }
      store.setFields(t.key, { documents: { sent_snapshot: `docs/sent-${stamp}` }, apply: { sent_at: new Date().toISOString(), channel: opt.channel || (t.apply && t.apply.channel) || '', confirmation: opt.confirmation || '' } }, { by: 'agent' });
      return console.log(`Saved what was sent (${copied.join(', ') || 'no files'}) in docs/sent-${stamp}.`);
    }

    case 'pdf-md': {
      const file = pos[0];
      if (!file || !fs.existsSync(file)) fail('Usage: hunt pdf-md <file.md>');
      const { marked } = require('marked');
      const body = marked.parse(fs.readFileSync(file, 'utf8').replace(/<[^>]+>/g, ''));
      const html = file.replace(/\.md$/i, '') + '.html';
      fs.writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:14mm}body{font:10pt/1.45 "Segoe UI",Arial,sans-serif;color:#1f2328}h1,h2,h3{color:#1f3864}table{border-collapse:collapse}td,th{border:1px solid #ccd;padding:3px 6px;vertical-align:top}code{font-size:9pt}</style>${body}`);
      const { pdf, pages } = require('../lib/pdf').htmlToPdf(html);
      fs.rmSync(html, { force: true });
      return console.log(`PDF: ${pdf} (${pages} pages)`);
    }

    case 'boards': {
      const boardsLib = require('../lib/boards');
      const sub = pos[0] || 'list';
      if (sub === 'validate') {
        const problems = boardsLib.validate();
        if (problems.length) fail(`Board registry problems:\n  - ${problems.join('\n  - ')}`, 1);
        return console.log(`Board registry OK (${boardsLib.load().length} boards).`);
      }
      if (sub === 'suggest') {
        const p = profileLib.loadProfile();
        const target = p.targets.find((t) => t.id === (opt.target || '')) || p.targets.find((t) => t.active) || p.targets[0];
        const ranked = boardsLib.suggest(p, target, require('../lib/plan').get(target.id));
        if (opt.json) return console.log(JSON.stringify(ranked.map((r) => ({ id: r.board.id, name: r.board.name, score: r.score, kind: r.board.access.kind, usable: r.usable, reasons: r.reasons, notes: r.board.notes || '' })), null, 2));
        console.log(`Boards for "${target.name}" (${target.id}), best first:`);
        for (const r of ranked.slice(0, Number(opt.limit) || 15)) console.log(`  ${String(r.score).padStart(3)}  ${r.board.id.padEnd(24)} ${r.board.access.kind.padEnd(8)} ${r.board.name}  [${r.reasons.join('; ')}]`);
        return;
      }
      if (sub === 'add') {
        const b = boardsLib.addCustom(readJsonFile(pos[1]));
        return console.log(`Board "${b.id}" added to the user's own boards (unverified).`);
      }
      const list = boardsLib.load();
      if (opt.json) return console.log(JSON.stringify(list, null, 2));
      for (const b of list) console.log(`${b.id.padEnd(24)} ${b.access.kind.padEnd(8)} ${b.countries.join(',').padEnd(14)} ${b.name}${b.verified ? '' : ' (unverified)'}`);
      return;
    }

    case 'plan': {
      const planLib = require('../lib/plan');
      const sub = pos[0] || 'show';
      if (sub === 'set') {
        if (!opt.target) fail('Usage: hunt plan set <file.json> --target t1');
        const saved = planLib.set(opt.target, readJsonFile(pos[1]));
        return console.log(`Search plan for ${opt.target} saved: ${saved.boards.length} boards, ${saved.queries.length} search words, ${saved.towns.length} towns.`);
      }
      if (sub === 'board') {
        const [, target, board, state] = pos;
        planLib.toggleBoard(target, board, state !== 'off');
        return console.log(`${board} is ${state === 'off' ? 'off' : 'on'} for ${target}.`);
      }
      const all = planLib.loadAll().targets;
      const ids = opt.target ? [opt.target] : Object.keys(all);
      if (opt.json) return console.log(JSON.stringify(opt.target ? all[opt.target] || null : all, null, 2));
      if (!ids.length) return console.log('No search plan yet. Use the plan-search skill.');
      for (const id of ids) {
        const p = all[id];
        if (!p) { console.log(`${id}: no plan yet`); continue; }
        console.log(`${id}: country ${p.country} | max age ${p.max_age_days} days | updated ${p.updated_at.slice(0, 10)}`);
        console.log(`  boards: ${p.boards.map((b) => `${b.id}${b.enabled ? '' : ' (off)'}`).join(', ')}`);
        console.log(`  search words: ${p.queries.join('; ')}`);
        if ((p.places || []).length) console.log(`  places: ${p.places.map((x) => `${x.name}${x.kind === 'region' ? ` (region${x.aliases.length ? `, also ${x.aliases.join('/')}` : ''}${(x.centers || []).length ? `; around ${x.centers.join(', ')}` : ''})` : ''}`).join('; ')}`);
        if (p.towns.length) console.log(`  towns: ${p.towns.join(', ')}`);
        const miss = require('../lib/places').missingFromPlan(profileLib.loadProfile(), profileLib.loadProfile().targets.find((t) => t.id === id), p);
        if (miss.length) console.log(`  THE PLACES CHANGED since this plan was made (not in it: ${miss.join(', ')}): make the plan again with the plan-search skill.`);
        if (p.companies.length) console.log(`  companies: ${p.companies.map((c) => c.name).join(', ')}`);
      }
      return;
    }

    case 'search': {
      if ((pos[0] || 'run') !== 'run') fail('Usage: hunt search run --target t1');
      const search = require('../lib/search');
      const report = await search.runSearch({ targetId: opt.target, pages: Number(opt.pages) || 2, maxReads: Number(opt['max-reads']) || 80, log: (m) => console.error(m) });
      if (opt.json) return console.log(JSON.stringify(report, null, 2));
      return console.log(search.summary(report));
    }

    case 'discover': {
      if (!['add', 'due'].includes(pos[0])) fail('Usage: hunt discover due [--target t1] | discover add <url...> | --file urls.json [--target t1] [--dry-run]');
      const discover = require('../lib/discover');
      if (pos[0] === 'due') {
        const p = profileLib.loadProfile();
        const target = p.targets.find((t) => t.id === (opt.target || '')) || p.targets.find((t) => t.active) || p.targets[0];
        if (!target) fail('No search target yet. Add one in Settings.');
        const d = discover.due(target.id);
        return console.log(`${d.due ? 'due' : 'not due'}: ${d.why}`);
      }
      const items = [...pos.slice(1).map((u) => ({ url: u, title: '' })), ...(typeof opt.file === 'string' ? discover.readUrls(fs.readFileSync(opt.file, 'utf8')) : [])];
      if (!items.length) fail('Give board URLs, or --file with a JSON list of URLs / {url, title}.');
      const p = profileLib.loadProfile();
      const target = p.targets.find((t) => t.id === (opt.target || '')) || p.targets.find((t) => t.active) || p.targets[0];
      if (!target) fail('No search target yet. Add one in Settings.');
      const res = await discover.addToPlan(target.id, items, { dryRun: opt['dry-run'] === true });
      if (opt.json) return console.log(JSON.stringify(res, null, 2));
      console.log(`${opt['dry-run'] ? '[dry run] ' : ''}${res.added.length} board(s) added to the plan of "${target.name}":`);
      for (const a of res.added) console.log(`  + ${a.name} (${a.ats}/${a.slug}, ${a.jobs} jobs)`);
      for (const s of res.skipped) console.log(`  - ${s.url}: ${s.reason}`);
      return;
    }

    case 'ingest': {
      // Results the AI collected with the browser: JSON array of {title, company, location, url, posted, body, salary, job_type}.
      if (!opt.target || !opt.source) fail('Usage: hunt ingest <file.json> --target t1 --source indeed');
      const search = require('../lib/search');
      const p = profileLib.loadProfile();
      const target = p.targets.find((t) => t.id === opt.target);
      if (!target) fail(`No search target ${opt.target}`);
      const plan = require('../lib/plan').get(target.id);
      if (!plan) fail(`No search plan for ${opt.target}. Use the plan-search skill first.`);
      let data = readJsonFile(pos[0]);
      if (data && Array.isArray(data.jobs)) data = data.jobs;
      const boardName = (require('../lib/boards').get(opt.source) || { name: opt.source }).name;
      const rows = (Array.isArray(data) ? data : []).filter((r) => r && r.title).map((r) => ({ ...r, source: r.source || boardName, native_id: r.native_id || r.id || require('../lib/dedupe').linkKey(r.url) || '' }));
      const res = await search.screen(rows, { profile: p, target, plan, run: `ingest-${opt.source}`, maxReads: 40, log: (m) => console.error(m) });
      console.log(`${opt.source}: ${rows.length} jobs, ${res.already_known} seen before.\n${require('../lib/funnel').describe(res.stages)}\nCandidates now waiting: node tools/hunt.js candidates --target ${opt.target}`);
      return;
    }

    case 'candidates': {
      const postings = require('../lib/postings');
      const sub = pos[0];
      if (sub === 'show') {
        const item = postings.get(pos[1]);
        if (!item) fail(`No candidate ${pos[1]}`);
        console.log(JSON.stringify(item, null, 2));
        return console.log(`\n--- job ad ---\n${postings.readBody(item.key) || '(no text)'}`);
      }
      if (sub === 'skip') {
        const keys = pos.slice(1);
        postings.setMany(keys, { status: 'skipped', reason: String(opt.reason || 'not a good fit').slice(0, 300) });
        return console.log(`Skipped ${keys.length}.`);
      }
      const list = postings.list({ status: 'candidate', target: opt.target }).slice(0, Number(opt.limit) || 40);
      if (opt.json) return console.log(JSON.stringify(list.map((i) => ({ ...i, text: postings.readBody(i.key).slice(0, Number(opt.chars) || 4000) })), null, 2));
      if (!list.length) return console.log('No candidates waiting. Run a search first.');
      for (const i of list) {
        console.log(`\n### ${i.key}\n${i.title} | ${i.company || '?'} | ${i.location || '?'} | posted ${i.posted || '?'} | ${i.source} | ${i.url}`);
        console.log(postings.readBody(i.key).slice(0, Number(opt.chars) || 1500).trim());
      }
      console.log(`\n${list.length} candidate(s). Score them, then add the good ones with "pool_key" (hunt add) and skip the rest (hunt candidates skip <key...> --reason "...").`);
      return;
    }

    case 'inbox': {
      const items = inbox.compute();
      if (opt.json) return console.log(JSON.stringify(items, null, 2));
      if (opt.hook) {
        if (!items.length) return;
        console.log(`Huntboard inbox (tell the user and offer to help):\n${items.map((i) => `- ${i.title}${i.text ? `: ${i.text}` : ''}${i.command ? ` (skill: ${i.command})` : ''}`).join('\n')}`);
        return;
      }
      if (!items.length) return console.log('Nothing needs attention right now.');
      for (const i of items) console.log(`- ${i.title}${i.text ? `: ${i.text}` : ''}${i.command ? `  → ${i.command}` : ''}`);
      return;
    }

    case 'ask':
      return cmdAsk(pos, opt);

    case 'needs': {
      const [key, ...words] = pos;
      if (!key) fail('Usage: hunt needs <KEY> "what the user must do"   or   hunt needs <KEY> --done');
      if (opt.done) {
        store.setNeeds(key, null, { by: opt.by === 'user' ? 'user' : 'agent' });
        return console.log(`${key}: done.`);
      }
      if (!words.length) fail('Say what the user must do, e.g. hunt needs JOB-3 "Robot check on the application page"');
      store.setNeeds(key, words.join(' '));
      if (process.env.HUNTBOARD_PROXY === '1') require('../lib/proxy').logDecision({ text: `Left for you: ${words.join(' ')}`, ticket: store.mustGet(key).key, run_id: process.env.HUNTBOARD_RUN_ID || null });
      return console.log(`${key} is on the user's "Needs you" list.`);
    }

    case 'followed-up': {
      const [key, ...words] = pos;
      if (!key) fail('Usage: hunt followed-up <KEY> "how"');
      store.addEvent(key, 'followup', words.join(' ') || 'Followed up');
      return console.log('Follow-up recorded.');
    }

    case 'decide': {
      const text = pos.join(' ').trim();
      if (!text) fail('Usage: hunt decide "what you decided for the user and why" [--ticket KEY]');
      const ticket = opt.ticket ? store.mustGet(opt.ticket).key : null;
      require('../lib/proxy').logDecision({ text, ticket, run_id: process.env.HUNTBOARD_RUN_ID || null });
      if (ticket) store.addNote(ticket, `Decided for you: ${text}`, { by: 'agent' });
      return console.log('Decision recorded.');
    }

    case 'export': {
      const file = pos[0] || path.join(paths.ws(), 'huntboard_export.xlsx');
      const n = await require('../lib/excel').exportXlsx(file);
      console.log(`Exported ${n} ticket(s) to ${file}`);
      return;
    }

    case 'import': {
      const res = await require('../lib/excel').importLegacyXlsx(pos[0]);
      console.log(`Imported ${res.added.length} ticket(s), skipped ${res.duplicates.length} duplicate(s).`);
      return;
    }

    case 'pdf': {
      const { pdf, pages } = require('../lib/pdf').htmlToPdf(pos[0], pos[1]);
      console.log(`PDF created: ${pdf}\nPages: ${pages}${pages > 1 ? '  (more than one page: shorten the text if it should fit on one)' : ''}`);
      return;
    }

    case 'update': {
      // With the app running, the app does the update (it knows whether the AI is busy, and restarts itself).
      const running = await api('GET', '/api/update/status').catch(() => null);
      if (opt.check) {
        const r = running ? await api('GET', '/api/update/check?fresh=1').catch((err) => fail(err.message, 1)) : await require('../lib/update').check().catch((err) => fail(`Could not check for updates: ${err.message}`, 1));
        if (!r.available) return console.log(`Huntboard ${r.current} is the newest version${r.unknown ? ' (as far as this download can tell; "update" installs the newest anyway)' : ''}.`);
        return console.log(`A new version is ready: ${r.current} → ${r.latest}${r.behind ? ` (${r.behind} change(s))` : ''}.${r.changes.length ? `\n  - ${r.changes.join('\n  - ')}` : ''}\nRun: node tools/hunt.js update`);
      }
      if (running) {
        try {
          await api('POST', '/api/update/apply');
        } catch (err) {
          fail(err.message, 1);
        }
        console.log('Huntboard is updating itself (your data stays as it is)…');
        let shown = 0;
        for (let i = 0; i < 1200; i++) {
          await sleep(1500);
          const s = await api('GET', '/api/update/status').catch(() => null);
          if (!s) return console.log('Huntboard is restarting with the new version. You can keep using it.');
          for (const line of s.log.slice(shown)) console.log(`  ${line}`);
          shown = s.log.length;
          if (s.error) fail(s.error, 1);
          if (s.done && !s.running) return console.log('Done. Huntboard is restarting with the new version.');
        }
        return;
      }
      try {
        const res = await require('../lib/update').apply({ log: (m) => console.log(`  ${m}`) });
        console.log(`Huntboard is up to date (${res.from} → ${res.to}). Start it again with start.bat / start.sh.${res.backup ? `\nYour data was backed up to ${res.backup}.` : ''}`);
      } catch (err) {
        fail(err.message, 1);
      }
      return;
    }

    default:
      fail(`Unknown command "${cmd}". Run "node tools/hunt.js help".`);
  }
}

main().catch((err) => fail(err.message || String(err)));
