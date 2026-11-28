// The fixes from Problems.md: photo from the CV, truthful CVs, the CV as uploaded, several places, links on every
// ticket, clean human text, updates and migrations, the e-mail skill, search names as hints, and models per task.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { freshWorkspace, ROOT } = require('./helpers');

const ws = freshWorkspace('features');
const profileLib = require('../lib/profile');
const store = require('../lib/store');
const cvLib = require('../lib/cv');
const documents = require('../lib/documents');
const factcheck = require('../lib/factcheck');
const humanize = require('../lib/humanize');
const photo = require('../lib/photo');
const places = require('../lib/places');
const planLib = require('../lib/plan');
const postings = require('../lib/postings');
const { nearby } = require('../lib/collectors');
const { makeGate } = require('../lib/gate');
const routing = require('../lib/ai/routing');
const prompts = require('../lib/ai/prompts');
const tar = require('../lib/tar');
const update = require('../lib/update');
const migrate = require('../lib/migrate');

// hunt(...args, { env }) : the last argument may be options (extra environment, e.g. an app run's HUNTBOARD_RUN_ID).
const hunt = (...args) => {
  const o = args.length && typeof args[args.length - 1] === 'object' ? args.pop() : {};
  return spawnSync(process.execPath, [path.join(ROOT, 'tools', 'hunt.js'), ...args], { encoding: 'utf8', env: { ...process.env, HUNTBOARD_WORKSPACE: ws, ...(o.env || {}) } });
};

const solid = (w, h, rgb) => {
  const px = new Uint8Array(w * h * 3);
  for (let i = 0; i < px.length; i += 3) px.set(rgb, i);
  return photo.encodePng(px, w, h, 3);
};

async function cvPdf() {
  const { PDFDocument } = require('pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawImage(await doc.embedPng(solid(300, 60, [0, 0, 200])), { x: 20, y: 780, width: 150, height: 30 }); // a logo
  page.drawImage(await doc.embedPng(solid(120, 160, [200, 150, 120])), { x: 450, y: 650, width: 90, height: 120 }); // the photo
  page.drawText('Alex Doe, Waiter. Hotel Esempio 2024. Customer service, espresso machines.', { x: 20, y: 700, size: 10 });
  return Buffer.from(await doc.save());
}

async function cvDocx() {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/media/image1.png', solid(120, 160, [200, 150, 120]));
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>');
  const pic = '<w:drawing><wp:inline><wp:extent cx="900000" cy="1200000"/><wp:docPr id="1" name="Photo"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="photo.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>';
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>Alex Doe</w:t></w:r></w:p><w:p><w:r>${pic}</w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('the photo is taken out of a CV (PDF and Word): the portrait, not the logo', async () => {
  const f = path.join(ws, 'cv.pdf');
  fs.writeFileSync(f, await cvPdf());
  const got = await photo.fromCv(f);
  assert.ok(got, 'a photo was found in the PDF');
  assert.deepStrictEqual([photo.imageSize(got.data).width, photo.imageSize(got.data).height], [120, 160]);

  const d = path.join(ws, 'cv.docx');
  fs.writeFileSync(d, await cvDocx());
  const fromWord = await photo.fromCv(d);
  assert.ok(fromWord, 'a photo was found in the Word file');
  assert.strictEqual(photo.imageSize(fromWord.data).height, 160);

  assert.strictEqual(photo.photoScore(300, 60), 0); // a banner or logo
  assert.ok(photo.photoScore(300, 400) > photo.photoScore(300, 300)); // passport-like wins

  await documents.add({ type: 'cv', filename: 'Alex_CV.pdf', data: await cvPdf() });
  const doc = await documents.photoFromCv();
  assert.strictEqual(doc.type, 'photo');
  assert.strictEqual(documents.list().filter((x) => x.type === 'photo').length, 1);
});

test('the user\'s own CV can be sent as it is, without tailoring', () => {
  const { added } = store.addTickets([{ title: 'Waiter', company: 'Hotel Uno', link: 'https://example.com/job/1' }], { by: 'user' });
  const rel = cvLib.useOriginal(added[0].key);
  const t = store.getTicket(added[0].key);
  assert.match(rel, /^docs\/CV_.*\.pdf$/);
  assert.ok(fs.existsSync(path.join(t._dir, rel)));
  assert.strictEqual(t.documents.cv, rel);
  assert.strictEqual(t.documents.cv_source, 'original');
  const p = profileLib.loadProfile();
  p.applying.cv_choice = 'nonsense';
  assert.strictEqual(profileLib.saveProfile(p).applying.cv_choice, 'tailored');
  p.applying.cv_choice = 'original';
  assert.strictEqual(profileLib.saveProfile(p).applying.cv_choice, 'original');
});

test('fact check: in a CV the job ad does not count, in a letter it does', () => {
  cvLib.save({
    name: 'Alex Doe', headline: 'Waiter',
    experience: [{ title: 'Waiter', company: 'Hotel Esempio S.r.l.', start: '2024-05', end: '2024-09', bullets: ['Served up to 120 guests'] }],
    education: [{ degree: 'Diploma', school: 'Liceo', end: '2021' }],
    skills: [{ group: 'Service', items: ['Customer service', 'espresso machines'] }],
    languages: [{ name: 'English', level: 'C1' }],
  });
  const ad = 'Kellner (m/w/d). Requirements: SAP, Kubernetes, 5 years of experience, German B2.';
  const [t] = store.addTickets([{ title: 'Kellner', company: 'Hotel Zwei', link: 'https://example.com/job/2', posting: ad }], { by: 'user' }).added;

  const tailored = { title: 'Kellner', summary: 'Served up to 120 guests, worked with SAP.', skills: [{ group: 'Service', items: ['Customer service', 'Kubernetes'] }], experience: [{ company: 'Hotel Esempio', bullets: ['Served guests'] }, { company: 'Grand Hotel Fake', bullets: ['x'] }] };
  const problems = factcheck.check(tailored, { ticket: t.key });
  assert.ok(problems.includes('SAP'), 'an acronym only the ad has is flagged in a CV');
  assert.ok(problems.some((p) => /skill "Kubernetes"/.test(p)), 'a skill only the ad has is flagged');
  assert.ok(problems.some((p) => /Grand Hotel Fake/.test(p)), 'an employer that is not in the CV is flagged');
  assert.ok(!problems.some((p) => /Hotel Esempio|Customer service|Kellner/.test(p)), 'own employer, own skill and the ad\'s title are fine');

  // A letter may name what the ad asks for.
  assert.deepStrictEqual(factcheck.check({ paragraphs: ['I read that your team moves its tills to SAP.'] }, { ticket: t.key }), []);
  // What the user confirms on the ticket counts.
  store.addNote(t.key, 'The user confirmed: Kubernetes course 2025', { by: 'user' });
  assert.ok(!factcheck.check(tailored, { ticket: t.key }).some((p) => /Kubernetes/.test(p)));
  // A whole (translated) CV may not have more jobs than the user.
  const full = { name: 'Alex Doe', experience: [{ company: 'Hotel Esempio' }, { company: 'Hotel Esempio' }], education: [] };
  assert.ok(factcheck.check(full).some((p) => /experience: 2 entries, the user's CV has 1/.test(p)));

  // The render refuses a CV with invented facts.
  const f = path.join(ws, 'tmp_cv.json');
  fs.writeFileSync(f, JSON.stringify(tailored));
  const r = hunt('cv', 'render', '--ticket', t.key, '--overrides', f);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /was NOT made/);
});

test('documents lose invisible characters; the style check names AI clichés', () => {
  assert.strictEqual(humanize.clean('Hello​world — really ok­ay﻿'), 'Helloworld – really okay');
  assert.strictEqual(humanize.clean('می‌شود'), 'می‌شود'); // Persian keeps its joiner
  assert.deepStrictEqual(humanize.cleanDeep({ a: ['x​y'], n: 3 }), { a: ['xy'], n: 3 });
  const hints = humanize.lint('I am passionate about leveraging synergies — moreover I thrive in fast-paced teams.', 'en');
  assert.ok(hints.some((h) => /passionate/.test(h) && /leveraging/.test(h)));
  assert.ok(hints.some((h) => /em dashes/.test(h)));
  assert.deepStrictEqual(humanize.lint('Ich habe drei Sommer im Hotel Esempio gekellnert und an guten Tagen 120 Gäste bedient.', 'de'), []);
  const same = Array.from({ length: 6 }, (_, i) => `I worked at place number ${i} for some time.`).join(' ');
  assert.ok(humanize.lint(same, 'en').some((h) => /same length|start the same way/.test(h)));
});

test('several places: cities and regions, whole-word matching', () => {
  const p = profileLib.loadProfile();
  p.location = { ...p.location, city: 'Leipzig', country: 'Germany', places: 'Berlin, Leipzig; Sachsen, berlin' };
  const saved = profileLib.saveProfile(p);
  assert.deepStrictEqual(saved.location.places, ['Berlin', 'Leipzig', 'Sachsen']);
  const target = profileLib.normalizeTarget({ id: 't1', job_types: ['part_time'], location: { city: 'Dresden', radius_km: 30 } }, 0);
  assert.deepStrictEqual(target.location.places, ['Dresden']);

  const plan = planLib.normalize({ queries: ['Kellner'], boards: ['arbeitsagentur'], places: [{ name: 'Sachsen', kind: 'region', aliases: ['Saxony'], centers: ['Leipzig', 'Dresden'] }, 'Berlin'] }).plan;
  assert.strictEqual(plan.places.length, 2);
  const list = places.searchPlaces(saved, saved.targets[0], plan);
  assert.deepStrictEqual(list.map((x) => `${x.name}:${x.kind}`), ['Berlin:city', 'Leipzig:city', 'Sachsen:region']);
  assert.deepStrictEqual(places.missingFromPlan(saved, saved.targets[0], plan), ['Leipzig']);

  const ctx = { towns: [], city: 'Berlin', places: list, remote: 'no' };
  assert.ok(nearby('Dresden, Saxony, Germany', ctx));
  assert.ok(nearby('04109 Leipzig SACHSEN', ctx));
  assert.ok(!nearby('Hannover Niedersachsen', ctx), 'Sachsen is not Niedersachsen');
  const gate = makeGate({ profile: saved, target: saved.targets[0], plan: { ...plan, max_age_days: 14 }, tickets: [] });
  assert.strictEqual(gate({ title: 'Kellner', location: 'Hamburg' }), 'too far away');
  assert.strictEqual(gate({ title: 'Kellner', location: 'Chemnitz', in_region: 'Sachsen' }), null, 'a board\'s region search counts');
});

test('a job the AI adds keeps the link to its ad, and one without a link is refused', () => {
  const [item] = postings.upsert([{ source: 'Test', native_id: 'a1', title: 'Barkeeper', company: 'Bar Drei', location: 'Leipzig', url: 'https://example.com/ads/a1' }]);
  const f = path.join(ws, 'new_jobs.json');
  fs.writeFileSync(f, JSON.stringify([{ pool_key: item.key, title: 'Barkeeper', company: 'Bar Drei' }, { title: 'Koch', company: 'Restaurant Vier' }]));
  const r = hunt('add', f);
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /Added 1 ticket/);
  assert.match(r.stdout, /NOT added, no usable link to the ad: "Koch"/);
  assert.match(r.stdout, /JOB-\d+ {2}Barkeeper @ Bar Drei {2}https:\/\/example\.com\/ads\/a1/, 'the output gives the ad link of each new ticket');
  const t = store.listTickets().find((x) => x.title === 'Barkeeper');
  assert.strictEqual(t.link, 'https://example.com/ads/a1');
  assert.ok(!store.listTickets().some((x) => x.title === 'Koch'));
});

test('ad links: the pool URL wins, fake or home-page links are refused, an AI run cannot pass as the user', () => {
  const { adUrl } = require('../lib/dedupe');
  assert.strictEqual(adUrl('/rc/clk?jk=12ab', 'https://it.indeed.com'), 'https://it.indeed.com/rc/clk?jk=12ab');
  assert.strictEqual(adUrl('www.reed.co.uk/jobs/cook/123'), 'https://reed.co.uk/jobs/cook/123');
  for (const bad of ['#', 'n/a', 'javascript:void(0)', 'https://www.stepstone.de/', '/rc/clk?jk=1']) assert.strictEqual(adUrl(bad), '', bad);

  const [item] = postings.upsert([{ source: 'Test', native_id: 'c3', title: 'Sous-chef', company: 'Hotel Sieben', url: 'https://example.com/ads/c3' }]);
  const f = path.join(ws, 'jobs2.json');
  fs.writeFileSync(f, JSON.stringify([
    { pool_key: item.key, link: 'https://example.com/search?q=chef', title: 'Sous-chef', company: 'Hotel Sieben' },
    { title: 'Kellnerin', company: 'Cafe Acht', link: 'https://www.example.org/' },
    { title: 'Barista', company: 'Cafe Neun', link: '/jobs/barista-9', source: 'Indeed' },
  ]));
  const r = hunt('add', f, '--by', 'user', { env: { HUNTBOARD_RUN_ID: 'run-test' } });
  assert.strictEqual(r.status, 1);
  assert.match(r.stdout, /NOT added, no usable link to the ad: "Kellnerin"/);
  const tickets = store.listTickets();
  assert.strictEqual(tickets.find((x) => x.title === 'Sous-chef').link, 'https://example.com/ads/c3');
  assert.strictEqual(tickets.find((x) => x.title === 'Barista').link, 'https://indeed.com/jobs/barista-9');
  const key = tickets.find((x) => x.title === 'Barista').key;
  const s = hunt('set', key, 'link=', { env: { HUNTBOARD_RUN_ID: 'run-test' } });
  assert.notStrictEqual(s.status, 0);
  assert.strictEqual(store.getTicket(key).link, 'https://indeed.com/jobs/barista-9');
});

test('migrations run once: lost links come back', () => {
  const [t] = store.addTickets([{ title: 'Spüler', company: 'Kantine Fünf' }], { by: 'user' }).added;
  const [item] = postings.upsert([{ source: 'Test', native_id: 'b2', title: 'Spüler', company: 'Kantine Fünf', url: 'https://example.com/ads/b2' }]);
  postings.update(item.key, { status: 'ticket', ticket: t.key });
  const first = migrate.runAll();
  assert.ok(first.find((m) => m.id === '2026-11-ticket-links').ok);
  assert.strictEqual(store.getTicket(t.key).link, 'https://example.com/ads/b2');
  assert.deepStrictEqual(migrate.runAll(), []);
  assert.deepStrictEqual(migrate.pending(), []);
});

test('updates: the archive reader and the file copy never touch the user\'s data', () => {
  const tgz = zlib.gzipSync(tar.pack([
    { name: 'Huntboard-abc/package.json', data: '{"version":"9.9.9"}' },
    { name: 'Huntboard-abc/lib/new.js', data: 'new' },
    { name: 'Huntboard-abc/workspace/profile/profile.json', data: 'HACKED' },
    { name: 'Huntboard-abc/.env', data: 'HACKED' },
  ]));
  const entries = tar.list(tgz);
  assert.deepStrictEqual(entries.map((e) => e.name), ['Huntboard-abc/package.json', 'Huntboard-abc/lib/new.js', 'Huntboard-abc/workspace/profile/profile.json', 'Huntboard-abc/.env']);
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'hb-update-'));
  fs.mkdirSync(path.join(root, 'workspace', 'profile'), { recursive: true });
  fs.writeFileSync(path.join(root, 'workspace', 'profile', 'profile.json'), 'MINE');
  fs.writeFileSync(path.join(root, '.env'), 'MY KEYS');
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'lib', 'old.js'), 'old');
  require('../lib/fsx').writeJson(path.join(ws, 'data', 'install.json'), { files: ['lib/old.js'] });
  const files = update.installFiles(entries, root);
  assert.deepStrictEqual(files.sort(), ['lib/new.js', 'package.json']);
  assert.strictEqual(fs.readFileSync(path.join(root, 'workspace', 'profile', 'profile.json'), 'utf8'), 'MINE');
  assert.strictEqual(fs.readFileSync(path.join(root, '.env'), 'utf8'), 'MY KEYS');
  assert.ok(!fs.existsSync(path.join(root, 'lib', 'old.js')), 'a file the new version no longer has is removed');
  assert.ok(update.newer('0.10.0', '0.9.9'));
  assert.ok(!update.newer('0.2.0', '0.2.0'));
  const saved = update.backup();
  assert.ok(fs.existsSync(path.join(saved, 'profile', 'profile.json')));
});

test('the e-mail skill exists and every writing task repeats the truth rules', () => {
  assert.ok(prompts.skillExists('email'));
  assert.ok(prompts.TASKS.email);
  const t = store.listTickets()[0];
  const text = prompts.build({ kind: 'skill', skill: 'email', ticket: t.key }, profileLib.loadProfile());
  assert.match(text, /Truth check/);
  assert.doesNotMatch(prompts.build({ kind: 'skill', skill: 'search' }, profileLib.loadProfile()), /Truth check/);
});

test('an unnamed search shows its name as a hint, a typed name is kept', () => {
  const p = profileLib.loadProfile();
  p.targets = [{ id: 't1', name: '', job_types: ['mini_job'], roles: { scope: 'any', titles: [] } }, { id: 't2', name: 'My search', job_types: ['full_time'] }, { id: 't3', name: 'Jobs in Berlin', job_types: ['full_time'] }];
  const saved = profileLib.saveProfile(p).targets;
  assert.match(saved[0].name, /Mini-job/);
  assert.strictEqual(saved[0].name_auto, true);
  assert.strictEqual(saved[1].name_auto, true);
  assert.strictEqual(saved[2].name, 'Jobs in Berlin');
  assert.strictEqual(saved[2].name_auto, false);
});

test('each task gets the model of its tier', () => {
  const s = { ai: { tool: 'claude', model: 'old-model', models: { claude: { light: 'haiku', standard: 'sonnet', strong: 'opus' } }, task_tiers: { search: 'light' } } };
  assert.strictEqual(routing.modelFor(s, 'claude', 'tailor'), 'opus');
  assert.strictEqual(routing.modelFor(s, 'claude', 'test'), 'haiku');
  assert.strictEqual(routing.modelFor(s, 'claude', 'search'), 'haiku', 'the user moved search to light');
  assert.strictEqual(routing.modelFor(s, 'claude', 'chat'), 'sonnet');
  assert.strictEqual(routing.modelFor({ ai: { model: 'old-model' } }, 'claude', 'tailor'), 'old-model', 'older settings keep working');
  assert.strictEqual(routing.modelFor({ ai: { models: { claude: { standard: 'sonnet' } } } }, 'claude', 'cover-letter'), 'sonnet');
  assert.strictEqual(routing.modelFor({ ai: {} }, 'gemini', 'tailor'), '');
});
