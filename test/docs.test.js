const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshWorkspace, ROOT } = require('./helpers');

const ws = freshWorkspace('docs');
const render = require('../lib/render');
const factcheck = require('../lib/factcheck');
const attachments = require('../lib/attachments');
const eml = require('../lib/eml');
const documents = require('../lib/documents');
const cvLib = require('../lib/cv');
const profileLib = require('../lib/profile');
const store = require('../lib/store');

const CV = {
  name: 'Alex Doe', headline: 'Waiter',
  experience: [{ title: 'Waiter', company: 'Hotel Esempio', start: '2024-05', end: '2024-09', bullets: ['Served up to 120 guests'] }, { title: 'Barista', company: 'Caffè Demo', start: '2023-06', end: 'present', bullets: ['Espresso'] }],
  education: [{ degree: 'Diploma', school: 'Liceo', end: '2021', grade: '85/100' }],
  certificates: [{ name: 'HACCP', issuer: 'Example Training', date: '2024' }],
  languages: [{ name: 'Italian', level: 'native' }, { name: 'English', level: 'C1' }],
};

test('dates and labels follow the document language', () => {
  assert.strictEqual(render.fmtDate('2024-05', render.locale('it')), '05/2024');
  assert.strictEqual(render.fmtDate('2024-05', render.locale('en')), 'May 2024');
  assert.strictEqual(render.fmtDate('present', render.locale('de')), 'heute');
  assert.strictEqual(render.locale('Italian').code, 'it');
  const profile = profileLib.loadProfile();
  profile.person = { ...profile.person, name: 'Alex Doe', email: 'a@example.com', city: 'Rimini' };
  const it = render.cvHtml(CV, profile, { lang: 'it' });
  assert.match(it, /Esperienza lavorativa/);
  assert.match(it, /madrelingua/);
  assert.match(it, /GDPR/);
  const en = render.cvHtml(CV, profile, { lang: 'en' });
  assert.match(en, /Work experience/);
  assert.doesNotMatch(en, /GDPR/);
  assert.doesNotMatch(render.cvHtml({ ...CV, name: '<script>x</script>' }, profile, { lang: 'en' }), /<script>x/);
});

test('tailoring changes merge into the base CV without touching other jobs', () => {
  const m = render.merge(CV, { title: 'Cameriere', experience: [{ company: 'hotel esempio', bullets: ['Servizio ai tavoli'] }], order: ['Caffè Demo'] });
  assert.strictEqual(m.headline, 'Cameriere');
  assert.strictEqual(m.experience[0].company, 'Caffè Demo');
  assert.deepStrictEqual(m.experience[1].bullets, ['Servizio ai tavoli']);
  assert.deepStrictEqual(CV.experience[0].bullets, ['Served up to 120 guests']);
});

test('fact check flags numbers, levels and certificates that are not in the user data', () => {
  cvLib.save(CV);
  assert.deepStrictEqual(factcheck.check({ summary: 'Served up to 120 guests, English C1, HACCP certified' }), []);
  assert.deepStrictEqual(factcheck.check({ summary: 'Served 300 guests with German B2 and an ISO 9001 audit, 5 years of experience' }).sort(), ['300', '5 years', '9001', 'B2', 'ISO'].sort());
  const { added } = store.addTickets([{ title: 'Waiter', company: 'Hotel Sole', posting: 'Contratto 30 ore settimanali' }]);
  assert.deepStrictEqual(factcheck.check({ p: 'Disponibile per 30 ore settimanali' }, { ticket: added[0].key }), []);
});

test('attachments: country custom decides, sensitive documents never go in', async () => {
  const ref = await documents.add({ type: 'reference', srcPath: path.join(ROOT, 'examples', 'alex-doe', 'cv.pdf'), title: 'Reference' });
  await documents.add({ type: 'work_permit', srcPath: path.join(ROOT, 'examples', 'alex-doe', 'cv.pdf'), title: 'Permit' });
  assert.deepStrictEqual(attachments.choose({ setting: 'country_default', country: 'Italy' }), []);
  assert.deepStrictEqual(attachments.choose({ setting: 'country_default', country: 'Germany' }).map((d) => d.id), [ref.id]);
  assert.deepStrictEqual(attachments.choose({ setting: 'never', country: 'Germany' }), []);
  const res = await attachments.build(attachments.choose({ setting: 'always' }), path.join(ws, 'out', 'Attachments.pdf'));
  assert.strictEqual(res.pages, 1);
  assert.ok(fs.statSync(res.file).size > 1000);
});

test('e-mail draft opens as an unsent message with the attachments', () => {
  const file = path.join(ROOT, 'examples', 'alex-doe', 'cv.pdf');
  const out = eml.build({ from: 'Alex Doe <a@example.com>', to: 'jobs@example.com', subject: 'Candidatura – Cameriere', body: 'Buongiorno,\nin allegato…', attachments: [file] });
  assert.match(out, /X-Unsent: 1/);
  assert.match(out, /Subject: =\?UTF-8\?B\?/);
  assert.match(out, /filename="cv\.pdf"/);
});
