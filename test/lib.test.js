const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshWorkspace, ROOT } = require('./helpers');

const ws = freshWorkspace('lib');
const dedupe = require('../lib/dedupe');
const profileLib = require('../lib/profile');
const documents = require('../lib/documents');
const cvLib = require('../lib/cv');
const store = require('../lib/store');
const steps = require('../lib/ai/steps');
const { ADAPTERS } = require('../lib/ai/adapters');

test('link keys and name keys', () => {
  assert.strictEqual(dedupe.linkKey('https://de.indeed.com/viewjob?jk=0123456789abcdef&from=serp'), 'indeed:0123456789abcdef');
  assert.strictEqual(dedupe.linkKey('https://www.linkedin.com/jobs/view/senior-dev-at-acme-3999999999?trk=x'), 'linkedin:3999999999');
  assert.strictEqual(dedupe.linkKey('https://www.stepstone.de/stellenangebote--Softwareentwickler-Hamburg-ACME--12345678-inline.html'), 'stepstone:12345678');
  assert.strictEqual(dedupe.linkKey('https://example.com/jobs/1?utm_source=a#top'), 'url:https://example.com/jobs/1');
  assert.strictEqual(dedupe.normalizeCompany('ACME GmbH & Co. KG'), 'acme');
  assert.strictEqual(dedupe.normalizeCompany('Hotel Rex S.r.l.'), 'hotel rex');
  assert.strictEqual(
    dedupe.nameKey({ title: 'Softwareentwickler (m/w/d)', company: 'ACME GmbH', location: 'Hamburg, Sachsen' }),
    dedupe.nameKey({ title: 'Softwareentwickler', company: 'Acme', location: 'Hamburg' }),
  );
});

test('profile defaults, targets and settings token', () => {
  const p = profileLib.loadProfile();
  assert.strictEqual(p.applying.mode, 'assist');
  p.targets.push({ job_types: ['mini_job', 'bogus'], roles: { scope: 'any' } });
  p.applying.mode = 'nonsense';
  const saved = profileLib.saveProfile(p);
  assert.strictEqual(saved.targets.length, 2);
  assert.deepStrictEqual(saved.targets[1].job_types, ['mini_job']);
  assert.strictEqual(saved.targets[1].id, 't2');
  assert.match(saved.targets[1].name, /Mini-job/);
  assert.strictEqual(saved.applying.mode, 'assist');
  const s = profileLib.loadSettings();
  assert.ok(s.token.length >= 20);
  assert.strictEqual(profileLib.loadSettings().token, s.token);
});

test('documents: add, extract text from md and pdf, sensitive defaults', async () => {
  const cv = await documents.add({ type: 'cv', srcPath: path.join(ROOT, 'examples', 'alex-doe', 'cv.pdf') });
  assert.strictEqual(cv.text_status, 'ok');
  assert.match(documents.readText(cv.id), /Alex Doe/);
  const ref = await documents.add({ type: 'reference', srcPath: path.join(ROOT, 'examples', 'alex-doe', 'reference_hotel.md') });
  assert.strictEqual(ref.attach, true);
  assert.match(documents.readText(ref.id), /would hire Alex again/);
  const permit = await documents.add({ type: 'work_permit', filename: 'permit.png', data: Buffer.from('fakepng') });
  assert.strictEqual(permit.sensitive, true);
  assert.strictEqual(permit.attach, false);
  assert.strictEqual(permit.text_status, 'image');
  assert.ok(documents.remove(permit.id));
  assert.strictEqual(documents.list().length, 2);
  assert.deepStrictEqual(profileLib.missing(profileLib.loadProfile(), documents.list()), ['location']);
});

test('structured CV validation', () => {
  assert.throws(() => cvLib.save({ experience: 'x' }), /not saved/);
  const saved = cvLib.save({ name: 'Alex Doe', experience: [{ title: 'Waiter', company: 'Hotel', bullets: ['Served guests'] }] });
  assert.deepStrictEqual(saved.education, []);
  assert.strictEqual(cvLib.load().name, 'Alex Doe');
});

test('spreadsheet export and import of the old job list', async () => {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  const sh = wb.addWorksheet('Jobs');
  sh.addRow(['Nr', 'Job Name', 'Company', 'Job Description', 'Job Requirements', 'Salary', 'Location', 'Job Type', 'Category', 'Date Posted', 'Job Link', 'Fit for Me', 'Status']);
  sh.addRow([1, 'Cameriere', 'Bar Uno', 'Servizio ai tavoli', 'Inglese', '9 €/h', 'Rimini (RN)', 'Part-time', 'Bar', '2026-09-01', { text: 'View', hyperlink: 'https://it.indeed.com/viewjob?jk=aaaabbbbccccdddd' }, 'Good – near home', 'Rejected']);
  const legacy = path.join(ws, 'old.xlsx');
  await wb.xlsx.writeFile(legacy);
  const excel = require('../lib/excel');
  const res = await excel.importLegacyXlsx(legacy);
  assert.strictEqual(res.added.length, 1);
  assert.strictEqual(res.added[0].status, 'closed');
  assert.strictEqual(res.added[0].resolution, 'rejected');
  assert.strictEqual(res.added[0].fit.score, 70);
  const again = await excel.importLegacyXlsx(legacy);
  assert.strictEqual(again.duplicates.length, 1);
  const out = path.join(ws, 'export.xlsx');
  assert.strictEqual(await excel.exportXlsx(out), store.listTickets().length);
  assert.ok(fs.statSync(out).size > 1000);
});

test('progress lines are plain language', () => {
  assert.strictEqual(steps.describe('Bash', { command: 'node tools/hunt.js add workspace/tmp/x.json' }), 'Adding jobs to the board');
  assert.strictEqual(steps.describe('PowerShell', { command: 'node tools/hunt.js move JOB-3 applied' }), 'Moving a ticket (JOB-3)');
  assert.strictEqual(steps.describe('mcp__playwright__browser_navigate', { url: 'https://www.indeed.com/jobs?q=x' }), 'Opening indeed.com');
  assert.strictEqual(steps.describe('run_command', { CommandLine: 'node tools/hunt.js ask "x"' }), 'Waiting for your answer');
});

test('adapters never put user text on the command line', () => {
  const platforms = JSON.parse(fs.readFileSync(path.join(ROOT, 'agent', 'platforms.json'), 'utf8'));
  for (const [id, a] of Object.entries(ADAPTERS)) {
    const args = a.args({ prompt: 'Read the file workspace/runs/run-1/prompt.md and do exactly what it says.', model: 'evil; rm -rf /', session: 'bad id with spaces', fullAccess: false, platforms, settingsFile: 'x.json', workspace: '/w' });
    assert.ok(!args.some((x) => /evil|bad id/.test(x)), `${id} passed unsafe values`);
  }
});

test('the claude adapter parses its stream', () => {
  const st = {};
  const ev = [
    ...ADAPTERS.claude.parse({ type: 'system', subtype: 'init', session_id: 's1' }, st),
    ...ADAPTERS.claude.parse({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'node tools/hunt.js inbox' } }] } }, st),
    ...ADAPTERS.claude.parse({ type: 'result', subtype: 'success', is_error: false, result: 'Done' }, st),
  ];
  assert.deepStrictEqual(ev.map((e) => e.type), ['session', 'step', 'result']);
  assert.strictEqual(ev[1].text, 'Checking what needs attention');
  assert.strictEqual(ev[2].ok, true);
});

test('the antigravity adapter parses its stream and denials', () => {
  const st = {};
  const ev = [
    ...ADAPTERS.antigravity.parse({ event: 'init', conversation_id: 'c1' }, st),
    ...ADAPTERS.antigravity.parse({ event: 'step_update', step_update: { conversation_id: 'c1', step_type: 'tool', state: 'ACTIVE', tool_name: 'run_command', tool_info: { parameters: { CommandLine: 'node tools/hunt.js docs list' } } } }, st),
    ...ADAPTERS.antigravity.parse({ event: 'result', result: { conversation_id: 'c1', status: 'SUCCESS', response: '', denied_actions: [{ action: 'command', display_name: 'RunCommand' }] } }, st),
  ];
  assert.deepStrictEqual(ev.map((e) => e.type), ['session', 'step', 'result']);
  assert.strictEqual(ev[1].text, 'Reading your documents');
  assert.strictEqual(ev[2].ok, false);
  assert.deepStrictEqual(ev[2].denied, ['RunCommand']);
});
