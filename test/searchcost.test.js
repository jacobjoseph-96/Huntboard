// Related job titles, the quick fit check, the short candidate view, `hunt score`, boards read from their result
// pages, and the "Save AI usage" limits.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { freshWorkspace, ROOT } = require('./helpers');

const ws = freshWorkspace('searchcost');
const roles = require('../lib/roles');
const { titleMatches, parseHtmlCards, fillTemplate } = require('../lib/collectors');
const { prescore, requirementsOf, summaryOf } = require('../lib/prescore');
const postings = require('../lib/postings');
const store = require('../lib/store');
const planLib = require('../lib/plan');
const profileLib = require('../lib/profile');
const economy = require('../lib/economy');
const routing = require('../lib/ai/routing');
const prompts = require('../lib/ai/prompts');

const hunt = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'hunt.js'), ...args], { encoding: 'utf8', env: { ...process.env, HUNTBOARD_WORKSPACE: ws } });

const CV = {
  skills: [{ group: 'Tech', items: ['C++', 'Qt', 'Python', 'Linux'] }],
  experience: [{ title: 'Software developer', company: 'Acme', start: '2022-01', end: 'present', tech: 'C++ · Qt' }],
  languages: [{ name: 'English', level: 'C1' }],
};
const PROFILE = { about: { languages: [{ name: 'English', level: 'C1' }, { name: 'German', level: 'A2' }] } };
const TARGET = { id: 't1', job_types: ['full_time'], roles: { scope: 'custom', titles: ['C++ developer'] } };

test('a search for "C++ developer" also looks for the other names of the same job', () => {
  const de = roles.expandTitles(['C++ developer'], { country: 'DE' });
  for (const t of ['C++ software developer', 'C++ software engineer', 'C++ engineer', 'C++ programmer', 'C++ Entwickler', 'Softwareentwickler C++']) assert.ok(de.includes(t), `${t} in ${de.join(' | ')}`);
  assert.deepStrictEqual(roles.expandTitles(['Mechanical engineer']), ['Mechanical engineer'], 'an engineer outside software stays as it is');
  assert.ok(roles.expandTitles(['Waiter']).includes('server'));
  const plan = { queries: ['C++ developer'], country: 'IT' };
  assert.ok(planLib.queriesFor(TARGET, plan).includes('Sviluppatore C++'));
  assert.deepStrictEqual(planLib.queriesFor({ roles: { scope: 'any' } }, { queries: ['part time'] }), ['part time']);
  // The title filter keeps "C++" (normalize() alone would turn it into "c" and drop it).
  const ctx = { scope: 'custom', title_keywords: [], queries: ['C++ developer'] };
  assert.ok(titleMatches('C++ Software Engineer (m/w/d)', ctx), '"C++" survives the filter');
  assert.ok(!titleMatches('Software Engineer (m/w/d)', ctx), 'only the typed words: "engineer" is not among them');
  assert.ok(titleMatches('Software Engineer (m/w/d)', { ...ctx, queries: planLib.queriesFor(TARGET, plan) }), 'the related titles bring it in');
  assert.ok(titleMatches('Senior C++ Engineer', { ...ctx, title_keywords: ['c++'] }));
});

test('the quick fit check ranks a matching ad first and flags a missing language', () => {
  const plan = { queries: ['C++ developer'], country: 'DE' };
  const good = prescore({ title: 'C++ Software Engineer', body: 'We use C++17 and Qt on Linux. Python is a plus.' }, { profile: PROFILE, cv: CV, target: TARGET, plan });
  const other = prescore({ title: 'Lagerhelfer', body: 'Sie arbeiten im Lager und kommissionieren Ware für unsere Kunden und die Filialen mit dem Stapler.' }, { profile: PROFILE, cv: CV, target: TARGET, plan });
  const german = prescore({ title: 'C++ Developer', body: 'C++ and Qt. Fluent German (C1) is required for this role.' }, { profile: PROFILE, cv: CV, target: TARGET, plan });
  assert.ok(good.score > german.score && german.score > other.score, `${good.score} > ${german.score} > ${other.score}`);
  assert.deepStrictEqual(good.matched.slice(0, 3), ['C++', 'Qt', 'Python']);
  assert.ok(german.missing.some((m) => /German C1/.test(m)), german.missing.join(', '));
  assert.ok(other.score < 20, 'nothing matches: below the floor');
  const ad = 'Software Developer | Acme | Berlin\n\nWe build robots. You will write firmware.\nYour profile\n- 3 years of C++\n- Qt\nWe offer\n- Fruit';
  assert.strictEqual(requirementsOf(ad), '3 years of C++ · Qt');
  assert.match(summaryOf(ad), /^We build robots\./);
});

test('boards read from their result pages: cards with absolute ad links, one per ad', () => {
  const page = `<li><a href="/jobs/c-developer/57608533?source=searchResults&amp;q=x" title="C++ Developer"><img></a>
    <h2><a href="/jobs/c-developer/57608533?source=searchResults">C++ Developer</a></h2></li>
    <li><a href="https://www.reed.co.uk/jobs/qt-engineer/57600001">Qt &amp; C++ Engineer</a></li>
    <a href="/jobs/search?keywords=c">More jobs</a>`;
  const cards = parseHtmlCards(page, String.raw`/jobs/[a-z0-9-]+/\d{6,}`, 'https://www.reed.co.uk/jobs?keywords=c');
  assert.deepStrictEqual(cards, [
    { url: 'https://reed.co.uk/jobs/c-developer/57608533', title: 'C++ Developer' },
    { url: 'https://reed.co.uk/jobs/qt-engineer/57600001', title: 'Qt & C++ Engineer' },
  ]);
  assert.strictEqual(fillTemplate('https://x.de/jobs/{q_slug}/in-{where_slug}?r={radius}', { q_slug: 'c-entwickler', where_slug: 'berlin', radius: 30 }), 'https://x.de/jobs/c-entwickler/in-berlin?r=30');
  const html = require('../lib/boards').load().filter((b) => b.access.collector === 'html');
  assert.ok(html.length >= 5 && html.every((b) => b.access.playbook), 'each scripted board can fall back to the browser');
  assert.deepStrictEqual(require('../lib/boards').validate(), []);
});

test('the short candidate view and hunt score: the AI writes only scores, Huntboard builds the tickets', () => {
  profileLib.saveProfile({ ...profileLib.loadProfile(), targets: [TARGET] });
  const body = 'C++ Developer | Robo GmbH | Berlin\n\nWe build robots in Berlin. You join a small team.\nIhr Profil\n- C++ and Qt\n- English\nWir bieten\n- Fruit';
  const [a, b] = postings.upsert([
    { source: 'Reed', native_id: '111111', title: 'C++ Developer', company: 'Robo GmbH', location: 'Berlin', url: 'https://reed.co.uk/jobs/c-developer/111111', body },
    { source: 'Reed', native_id: '222222', title: 'Java Developer', company: 'Kaffee AG', location: 'Berlin', url: 'https://reed.co.uk/jobs/java-developer/222222', body: 'Java Developer | Kaffee AG\n\nJava and Spring. '.repeat(10) },
  ], { target: 't1' });
  postings.update(a.key, { status: 'candidate', prescore: 80, matched: ['C++', 'Qt'] });
  postings.update(b.key, { status: 'candidate', prescore: 30 });
  const brief = hunt('candidates', '--target', 't1', '--brief');
  assert.strictEqual(brief.status, 0, brief.stderr);
  assert.ok(brief.stdout.indexOf(a.key) < brief.stdout.indexOf(b.key), 'best first');
  assert.match(brief.stdout, /asks for: C\+\+ and Qt · English/);
  assert.match(brief.stdout, /matches the CV: C\+\+, Qt/);
  assert.ok(brief.stdout.length < 2500, `short: ${brief.stdout.length} chars`);

  const f = path.join(ws, 'scores.json');
  fs.writeFileSync(f, JSON.stringify([
    { key: a.key, score: 82, verdict: 'Good – C++ and Qt', reasons: ['C++ and Qt in the CV'], red_flags: [] },
    { key: b.key, score: 20, verdict: 'Java, not C++' },
    { key: 'nope:1', score: 90 },
  ]));
  const r = hunt('score', f, '--model', 'test-model');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Skipped 1 below 35%/);
  assert.match(r.stdout, /Not found in the candidates.*nope:1/);
  assert.match(r.stdout, /JOB-\d+ {2}C\+\+ Developer @ Robo GmbH {2}https:\/\/reed\.co\.uk\/jobs\/c-developer\/111111/);
  const t = store.listTickets().find((x) => x.company === 'Robo GmbH');
  assert.strictEqual(t.link, 'https://reed.co.uk/jobs/c-developer/111111');
  assert.strictEqual(t.fit.score, 82);
  assert.strictEqual(t.fit.scored_with, 'test-model');
  assert.strictEqual(t.target, 't1');
  assert.match(t.requirements, /C\+\+ and Qt; English/);
  assert.match(store.readPosting(t.key), /We build robots/);
  assert.strictEqual(postings.get(b.key).status, 'skipped');
});

test('"Save AI usage" is on by default for Antigravity and Gemini and sets the search limits', () => {
  assert.strictEqual(economy.isOn({ ai: { tool: 'antigravity', economy: 'auto' } }), true);
  assert.strictEqual(economy.isOn({ ai: { tool: 'claude', economy: 'auto' } }), false);
  assert.strictEqual(economy.isOn({ ai: { tool: 'claude', economy: 'on' } }), true);
  assert.strictEqual(economy.isOn({ ai: { tool: 'gemini', economy: 'off' } }), false);
  assert.strictEqual(routing.tierFor({ ai: { tool: 'gemini' } }, 'search'), 'light');
  assert.strictEqual(routing.tierFor({ ai: { tool: 'gemini', task_tiers: { search: 'strong' } } }, 'search'), 'strong', "the user's own choice wins");
  profileLib.saveSettings({ ai: { tool: 'antigravity', economy: 'auto' } });
  const p = prompts.build({ kind: 'skill', skill: 'search' }, profileLib.loadProfile());
  assert.match(p, /## Save AI usage/);
  assert.match(p, /at most 12 jobs/);
  profileLib.saveSettings({ ai: { tool: 'claude' } });
  assert.doesNotMatch(prompts.build({ kind: 'skill', skill: 'search' }, profileLib.loadProfile()), /## Save AI usage/);
  // Company boards: once a week instead of daily.
  const discover = require('../lib/discover');
  planLib.set('t1', { country: 'DE', queries: ['C++ developer'], boards: ['linkedin'] });
  const all = planLib.loadAll();
  all.targets.t1.discovered_at = '2026-11-25';
  require('../lib/fsx').writeJson(planLib.file(), all);
  assert.strictEqual(discover.due('t1', '2026-11-28', 7).due, false);
  assert.strictEqual(discover.due('t1', '2026-12-03', 7).due, true);
  assert.strictEqual(discover.due('t1', '2026-11-28', 1).due, true);
});
