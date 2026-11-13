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
  assert.match(it, /Italian:<\/b> Madrelingua/);
  assert.match(it, /GDPR/);
  const en = render.cvHtml(CV, profile, { lang: 'en' });
  assert.match(en, /Work experience/);
  assert.doesNotMatch(en, /GDPR/);
  assert.doesNotMatch(render.cvHtml({ ...CV, name: '<script>x</script>' }, profile, { lang: 'en' }), /<script>x/);
});

test('tailoring changes merge into the base CV without touching other jobs', () => {
  const m = render.merge(CV, { title: 'Cameriere', experience: [{ company: 'hotel esempio', bullets: ['Servizio ai tavoli'] }], order: ['Hotel Esempio'], hide_sections: ['references'] });
  assert.strictEqual(m.headline, 'Cameriere');
  assert.deepStrictEqual(m.experience.find((e) => e.company === 'Hotel Esempio').bullets, ['Servizio ai tavoli']);
  assert.deepStrictEqual(CV.experience[0].bullets, ['Served up to 120 guests']);
  // A CV that hides a section keeps it hidden when a job hides another one.
  assert.deepStrictEqual(render.merge({ ...CV, hidden: ['other'] }, { hide_sections: ['references'] }).hidden.sort(), ['other', 'references']);
});

test('jobs and education print newest first, whatever order they were written or asked in', () => {
  const profile = profileLib.loadProfile();
  const cv = {
    name: 'Alex Doe',
    experience: [
      { title: 'Lecturer', company: 'Old Uni', start: '2020', end: '2021' },
      { title: 'Engineer', company: 'Mid GmbH', start: '2022', end: '2025' },
      { title: 'Tools', company: 'New GmbH', start: '04/2026', end: '06/2026' },
      { title: 'Founder', company: 'Now Ltd', start: '2019-01', end: 'present' },
      { title: 'Helper', company: 'No Dates' },
    ],
    education: [{ degree: 'School', school: 'A', end: '2015' }, { degree: 'Degree', school: 'B', start: '10/2014', end: '01/2020' }],
  };
  const order = (html, names) => names.map((n) => html.indexOf(n));
  const html = render.cvHtml(render.merge(cv, { order: ['Old Uni', 'Mid GmbH'] }), profile, { lang: 'en' });
  const at = order(html, ['Now Ltd', 'New GmbH', 'Mid GmbH', 'Old Uni', 'No Dates', '>Degree<', '>School<']);
  assert.ok(at.every((x) => x > 0), 'every entry is printed');
  assert.deepStrictEqual([...at.slice(0, 5)].sort((a, b) => a - b), at.slice(0, 5));
  assert.ok(at[5] < at[6]);
  assert.strictEqual(render.dateKey('04/2026'), render.dateKey('2026-04'));
  assert.ok(render.dateKey('2025', true) > render.dateKey('2025-06', true));
  assert.strictEqual(render.dateKey('heute'), Infinity);
});

test('a CV written with other key names prints the same: languages as "Language: level", nothing half empty', () => {
  const profile = profileLib.loadProfile();
  const old = {
    name: 'Alex Doe', title: 'Engineer', email: 'a@example.com', phone: '+39 000', links: ['https://www.example.com/alex/'],
    languages: [{ language: 'English', level: 'C1' }, { label: 'German', text: 'B1' }, { language: 'Arabic', level: 'Native' }],
    skills: [{ group: 'Tools', items: 'Git, Docker' }],
    experience: [{ title: 'Engineer', company: 'Mid GmbH', start: '2022', end: '2025', tech: ['Qt', 'CMake'] }],
    education: [{ degree: 'B.Sc.', school: 'Uni', end: '2020', recognition: 'ZAB Zeugnisbewertung', notes: 'Coursework: Robotics' }],
  };
  const n = cvLib.normalize(old);
  assert.strictEqual(n.headline, 'Engineer');
  assert.strictEqual(n.contact.email, 'a@example.com');
  assert.deepStrictEqual(n.languages.map((l) => l.name), ['English', 'German', 'Arabic']);
  assert.deepStrictEqual(n.skills[0].items, ['Git, Docker']);
  const html = render.cvHtml(old, profile, { lang: 'en', template: 'classic' });
  for (const s of ['<b>English:</b> C1', '<b>German:</b> B1', '<b>Arabic:</b> Native', 'Engineer', 'a@example.com', 'example.com/alex', 'Git, Docker', 'Qt · CMake', 'ZAB Zeugnisbewertung', 'Coursework: Robotics']) {
    assert.ok(html.includes(s), `the CV shows "${s}"`);
  }
  assert.doesNotMatch(html, /\(C1\)|\(native\)/i);
  assert.match(cvLib.validate({ name: 'A', languages: [{ level: 'C1' }] }).join(' '), /languages\[0\] needs a "name"/);
});

test('every CV design renders the same content; the user picks one and may bring an own design', () => {
  const profile = profileLib.loadProfile();
  const ids = render.templates().map((t) => t.id);
  assert.deepStrictEqual(ids, ['classic', 'modern', 'sidebar', 'tabular', 'academic', 'creative']);
  const sample = render.sampleCv();
  for (const id of ids) {
    const html = render.cvHtml(sample, profile, { lang: 'en', template: id, photo: render.placeholderPhoto() });
    assert.match(html, new RegExp(`tpl-${id} `));
    for (const s of ['Alex Doe', 'Hotel Esempio', 'HACCP', '<b>English:</b> C1', 'class="photo"', 'Available from May']) assert.ok(html.includes(s), `${id} shows ${s}`);
    // Dates are moved with grid/flex only: floats change the order of the text inside the PDF.
    assert.doesNotMatch(render.template(id).css, /float\s*:/);
  }
  assert.match(render.cvHtml(sample, profile, { lang: 'en', template: 'sidebar' }), /<aside class="side">[\s\S]*sec-contact[\s\S]*<\/aside>/);
  assert.strictEqual(render.template('no-such-design').id, 'classic');
  assert.strictEqual(render.wantsPhoto({ cv: { photo: 'auto' } }, undefined), false);
  assert.strictEqual(render.wantsPhoto({ cv: { photo: 'auto' } }, 'yes'), true);
  assert.strictEqual(render.wantsPhoto({ cv: { photo: 'always' } }, 'no'), true);
  assert.strictEqual(render.wantsPhoto({ cv: { photo: 'never' } }, 'yes'), false);

  // Own design: started from a ready-made one, then it is template "own". Unsafe CSS is refused.
  render.initDesign('sidebar');
  assert.ok(render.templates().some((t) => t.id === 'own' && t.layout === 'sidebar'));
  assert.match(render.cvHtml(sample, profile, { lang: 'en', template: 'own' }), /tpl-own /);
  fs.writeFileSync(path.join(render.designDir(), 'design.css'), 'body { background: url(https://example.com/x.png); }');
  assert.throws(() => render.template('own'), /cannot be used/);
  assert.deepStrictEqual(render.checkCss('.a { background: url("data:image/png;base64,AAAA"); color: red; }'), []);
  assert.strictEqual(render.checkCss('</style><script>1</script>').length > 0, true);
  assert.strictEqual(render.checkCss('@import "x.css";').length > 0, true);
  fs.rmSync(render.designDir(), { recursive: true, force: true });
  assert.strictEqual(profileLib.saveProfile({ cv: { template: 'Side Bar!', photo: 'sometimes' } }).cv.photo, 'auto');
});

test('a cover letter has no enclosure line unless the letter asks for one', () => {
  const profile = profileLib.loadProfile();
  profile.person = { ...profile.person, name: 'Alex Doe' };
  const letter = { language: 'en', subject: 'Application for Waiter', salutation: 'Dear Ms Rossi,', paragraphs: ['One.', 'Two.'], closing: 'Kind regards,' };
  const plain = render.letterHtml(letter, profile, { lang: 'en' });
  assert.doesNotMatch(plain, /Enclosures|class="attach"/);
  assert.match(render.letterHtml({ ...letter, attachments_line: 'Enclosures: CV, references' }, profile, { lang: 'en' }), /class="attach">Enclosures: CV, references/);
  assert.doesNotMatch(render.letterHtml({ ...letter, language: 'de' }, profile, {}), /Anlagen/);
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
