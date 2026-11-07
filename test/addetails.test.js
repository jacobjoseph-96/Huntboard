const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshWorkspace } = require('./helpers');

freshWorkspace('addetails');
const store = require('../lib/store');
const { extract, _ } = require('../lib/addetails');
const { linkedinDetail } = require('../lib/adtext');

const DE = `Embedded C++ Entwickler (m/w/d)
Standort: Remscheid-DEU
Vollzeit, unbefristet. 2 Tage Homeoffice pro Woche.
Gehalt: 60.000 € – 75.000 € brutto pro Jahr
Bewerbungsfrist: 30.11.2026
Ihre Ansprechpartnerin
Anna Schmidt
Talent Acquisition
anna.schmidt@example.de`;

test('reads location, mode, job type, salary, apply-by and contact from a German ad', () => {
  const d = extract(DE);
  assert.strictEqual(d.location, 'Remscheid');
  assert.strictEqual(d.mode, 'Hybrid');
  assert.strictEqual(d.job_type, 'Full-time, Permanent');
  assert.match(d.salary, /^60\.000 € – 75\.000 € brutto pro Jahr$/);
  assert.strictEqual(d.deadline, '2026-11-30');
  assert.strictEqual(d.contact, 'Anna Schmidt, anna.schmidt@example.de');
});

test('English ad, and what it must not invent', () => {
  const d = extract('Senior C++ Engineer\nLocation: Berlin\nThis is a fully remote, full-time permanent position.\nApply by November 20, 2026. Contact person: Mr. John Miller');
  assert.deepStrictEqual(d, { location: 'Berlin', mode: 'Remote', job_type: 'Full-time, Permanent', deadline: '2026-11-20', contact: 'Mr. John Miller' });
  assert.deepStrictEqual(extract('We build robots. Weitere Vorteile\nBetriebliche Altersvorsorge'), {});
  assert.strictEqual(_.salary('Wir bieten 30 Tage Urlaub und 2.000 Mitarbeitende'), '');
  assert.strictEqual(_.jobType('befristet auf 2 Jahre'), 'Fixed-term');
  assert.strictEqual(_.place('Deutschland'), '');
  assert.strictEqual(_.place('Unsere Entwicklung ist in unserer Niederlassung in 86179 Augsburg tätig'), 'Augsburg');
  assert.strictEqual(extract('x', { city: 'Fulda', salary: '50k' }).location, 'Fulda');
});

test('LinkedIn guest page: top card and criteria', () => {
  const html = `<h2 class="top-card-layout__title">C++ Engineer with Qt/QML</h2><a class="topcard__org-name-link">Sigma Software</a>
    <span class="topcard__flavor topcard__flavor--bullet">Munich, Bavaria, Germany</span>
    <div class="salary compensation__salary">€60,000.00/yr - €80,000.00/yr</div>
    <div class="show-more-less-html__markup">We build IoT devices with Qt and C++.</div>
    <h3 class="description__job-criteria-subheader">Employment type</h3>
    <span class="description__job-criteria-text description__job-criteria-text--criteria">Full-time</span>`;
  const d = linkedinDetail(html);
  assert.strictEqual(d.location, 'Munich, Bavaria');
  assert.strictEqual(d.job_type, 'Full-time');
  assert.strictEqual(d.company, 'Sigma Software');
  assert.match(d.salary, /€60,000/);
});

test('saving an ad fills only empty fields; a saved ad is kept unless replace', () => {
  const [t] = store.addTickets([{ title: 'C++ Developer', company: 'Acme', job_type: 'Contract' }]).added;
  const r = store.fillFromAd(t.key, { text: DE, extra: { city: 'Wuppertal' }, from: 'from the search database' });
  assert.ok(r.saved);
  assert.strictEqual(r.ticket.location, 'Wuppertal');
  assert.strictEqual(r.ticket.job_type, 'Contract', 'a value already on the ticket stays');
  assert.strictEqual(r.ticket.deadline, '2026-11-30');
  assert.ok(r.ticket.ad_details_at);
  assert.match(r.ticket.history.slice(-1)[0].text, /Saved the job ad text \(from the search database\); read location/);
  const again = store.fillFromAd(t.key, { text: 'other text' });
  assert.ok(!again.saved);
  assert.match(store.readPosting(t.key), /Embedded C\+\+/);
  assert.ok(store.fillFromAd(t.key, { text: 'Other ad text', replace: true }).saved);

  const [u] = store.addTickets([{ title: 'Qt Developer', company: 'B', posting: DE }]).added;
  assert.strictEqual(u.mode, 'Hybrid');
  assert.strictEqual(u.salary.startsWith('60.000'), true);
  const [w] = store.addTickets([{ title: 'Pasted', company: 'C' }]).added;
  const pasted = store.writePosting(w.key, DE, { by: 'user' });
  assert.strictEqual(pasted.contact, 'Anna Schmidt, anna.schmidt@example.de');
  assert.ok(fs.existsSync(path.join(w._dir, 'posting.md')));
});
