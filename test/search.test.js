// Job board parsers (recorded answers), filters, funnel, plan and board ranking. No network.
const test = require('node:test');
const assert = require('node:assert');
const { freshWorkspace } = require('./helpers');

freshWorkspace('search');
const C = require('../lib/collectors');
const adtext = require('../lib/adtext');
const validate = require('../lib/validate');
const { makeGate } = require('../lib/gate');
const { Stage } = require('../lib/funnel');
const boards = require('../lib/boards');
const planLib = require('../lib/plan');
const profileLib = require('../lib/profile');
const store = require('../lib/store');
const postings = require('../lib/postings');
const search = require('../lib/search');

const AD = 'We are looking for a waiter for our restaurant. Your tasks: serving guests, taking orders. Requirements: experience in service, English. We offer a friendly team, weekend shifts and fair pay. '.repeat(3);

test('LinkedIn guest search fragment', () => {
  const html = `<li><div data-entity-urn="urn:li:jobPosting:4012345678"><h3 class="base-search-card__title">
    Waiter &amp; Barista </h3><h4 class="base-search-card__subtitle"><a href="x">Hotel Uno</a></h4>
    <span class="job-search-card__location">Rimini, Emilia-Romagna, Italy</span><time datetime="2026-11-01">5 days ago</time></div></li>
    <li><div>no id here</div></li>`;
  const rows = C.parseLinkedin(html);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].native_id, rows[0].title, rows[0].company, rows[0].posted], ['4012345678', 'Waiter & Barista', 'Hotel Uno', '2026-11-01']);
  assert.strictEqual(rows[0].url, 'https://www.linkedin.com/jobs/view/4012345678');
});

test('API answers of the other boards', () => {
  const ba = C.parseBa({ ergebnisliste: [{ referenznummer: '10001-1', stellenangebotsTitel: 'Aushilfe Lager', firma: 'Demo GmbH', datumErsteVeroeffentlichung: '2026-11-05', stellenlokationen: [{ adresse: { ort: 'Dresden', region: 'Sachsen' } }] }] });
  assert.deepStrictEqual([ba[0].title, ba[0].location, ba[0].url], ['Aushilfe Lager', 'Dresden Sachsen', 'https://www.arbeitsagentur.de/jobsuche/jobdetail/10001-1']);
  const an = C.parseArbeitnow({ data: [{ slug: 'dev-x', title: 'Developer', company_name: 'X', location: 'Berlin', created_at: 1762300000, url: 'https://arbeitnow.com/x', description: '<p>Hi</p>', remote: true }] });
  assert.strictEqual(an[0].remote, true);
  assert.strictEqual(an[0].body, 'Hi');
  const az = C.parseAdzuna({ results: [{ id: 99, title: '<strong>Barista</strong>', company: { display_name: 'Bar' }, location: { display_name: 'Rimini' }, created: '2026-11-02T10:00:00Z', redirect_url: 'https://adzuna/x', description: 'Coffee', salary_min: 1200 }] });
  assert.deepStrictEqual([az[0].title, az[0].salary, az[0].posted], ['Barista', '1200', '2026-11-02']);
  const jo = C.parseJooble({ jobs: [{ id: 5, title: 'Commesso', company: 'Negozio', location: 'Rimini', updated: '2026-11-03T00:00:00', link: 'https://jooble/x', snippet: '&nbsp;Vendita' }] });
  assert.strictEqual(jo[0].body, 'Vendita');
  const eu = C.parseEures({ jvs: [{ id: 'ABC=', title: 'Cook', employer: { name: 'Hotel' }, locationMap: { IT: [{ cityName: 'Rimini' }] }, creationDate: 1762300000000, description: '<p>Cook wanted</p>' }] });
  assert.deepStrictEqual([eu[0].location, eu[0].body], ['Rimini', 'Cook wanted']);
  assert.match(eu[0].url, /jv-details\/ABC%3D/);
  const rv = C.parseRemotive({ jobs: [{ id: 1, title: 'Support', company_name: 'R', candidate_required_location: 'Europe', publication_date: '2026-11-04T00:00:00', url: 'https://remotive/x', description: '<p>x</p>' }] });
  assert.strictEqual(rv[0].remote, true);
  const ro = C.parseRemoteok([{ legal: 'notice' }, { id: 7, position: 'Dev', company: 'O', date: '2026-11-04T00:00:00Z', tags: ['js'] }]);
  assert.strictEqual(ro.length, 1);
});

test('company career page APIs', () => {
  const gh = C.parseAts('greenhouse', JSON.stringify({ jobs: [{ id: 1, title: 'Engineer', location: { name: 'Berlin' }, absolute_url: 'https://gh/1', first_published: '2026-11-01T00:00:00Z', content: '&lt;p&gt;Build things&lt;/p&gt;' }] }), 'acme', 'ACME');
  assert.deepStrictEqual([gh[0].native_id, gh[0].body, gh[0].company], ['greenhouse:acme:1', 'Build things', 'ACME']);
  const lv = C.parseAts('lever', JSON.stringify([{ id: 'a', text: 'Designer', categories: { location: 'Remote' }, hostedUrl: 'https://jobs.lever.co/acme/a', createdAt: 1762000000000, descriptionPlain: 'Design' }]), 'acme', 'ACME');
  assert.strictEqual(lv[0].posted.length, 10);
  const ps = C.parseAts('personio', '<positions><position><id>7</id><name>Koch</name><office>Dresden</office><createdAt>2026-11-01T00:00:00+00:00</createdAt><jobDescriptions><![CDATA[<p>Kochen</p>]]></jobDescriptions></position></positions>', 'demo', 'Demo');
  assert.deepStrictEqual([ps[0].title, ps[0].location, ps[0].body], ['Koch', 'Dresden', 'Kochen']);
  assert.deepStrictEqual(C.slugCandidates('Vector Informatik GmbH'), ['vectorinformatik', 'vector-informatik', 'vectorinformatikcareers']);
});

test('schema.org JobPosting and LinkedIn ad pages', () => {
  const page = `<html><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Waiter","datePosted":"2026-11-01",
    "hiringOrganization":{"@type":"Organization","name":"Hotel Uno"},"jobLocation":{"address":{"addressLocality":"Rimini"}},"employmentType":"PART_TIME","description":"<p>Serve guests.</p><ul><li>English</li></ul>"}</script></html>`;
  const p = adtext.jobPostingFromHtml(page);
  assert.strictEqual(p.company, 'Hotel Uno');
  assert.match(p.text, /Waiter \| Hotel Uno \| Rimini \| PART_TIME/);
  assert.match(p.text, /- English/);
  const li = adtext.linkedinDetail('<span class="description__job-criteria-text">Part-time</span><div class="show-more-less-html__markup">Great job</div>');
  assert.match(li.text, /^Part-time\n\nGreat job/);
});

test('ad text checks', () => {
  assert.deepStrictEqual(validate.check(AD), { ok: true, reason: null });
  assert.strictEqual(validate.check('Just a moment... Checking your browser before accessing').reason, 'robot_check');
  assert.strictEqual(validate.check('short').reason, 'too_short');
  assert.strictEqual(validate.check('x '.repeat(400)).reason, 'not_a_job_ad');
  assert.ok(validate.check(`Cerchiamo cameriere. Mansioni: servizio ai tavoli. Requisiti: esperienza. Offriamo contratto stagionale. ${'testo '.repeat(60)}`).ok);
});

test('filters give clear reasons', () => {
  const profile = profileLib.loadProfile();
  profile.location = { ...profile.location, city: 'Rimini', remote: 'no' };
  profile.about.avoid = 'night shifts, call center';
  const target = { id: 't1', job_types: ['part_time'], roles: { scope: 'custom', titles: ['Waiter'] } };
  const plan = { queries: ['cameriere', 'waiter'], title_keywords: ['cameriere', 'waiter', 'barista'], towns: ['Rimini', 'Riccione'], max_age_days: 14 };
  const { added } = store.addTickets([{ title: 'Barista', company: 'Bar Due', location: 'Rimini' }], { by: 'user' });
  store.moveTicket(added[0].key, 'closed', { resolution: 'rejected' });
  const gate = makeGate({ profile, target, plan, tickets: store.listTickets(), now: Date.parse('2026-11-06') });
  const base = { title: 'Cameriere di sala', company: 'Hotel Uno', location: 'Riccione (RN)', posted: '2026-11-04' };
  assert.strictEqual(gate(base), null);
  assert.strictEqual(gate({ ...base, location: 'Milano' }), 'too far away');
  assert.strictEqual(gate({ ...base, posted: '2026-09-01' }), 'too old');
  assert.strictEqual(gate({ ...base, title: 'Cameriere turni night shifts' }), 'something you want to avoid');
  assert.strictEqual(gate({ ...base, title: 'Software Engineer' }), 'other field');
  assert.strictEqual(gate({ ...base, job_type: 'Full-time' }), 'full-time only');
  assert.match(gate({ ...base, company: 'Bar Due S.r.l.' }), /company said no/);
  assert.strictEqual(gate({ ...base, title: 'Cameriere', company: 'Bar Uno', location: 'Rimini' }), null);
  assert.strictEqual(gate({ ...base, body: 'Join our network marketing team' }), 'looks like a scam or paid scheme');
  const anyGate = makeGate({ profile, target: { ...target, roles: { scope: 'any', titles: [] } }, plan, tickets: [] , now: Date.parse('2026-11-06') });
  assert.strictEqual(anyGate({ ...base, title: 'Magazziniere' }), null);
  // Same-day plan (max_age_days 1), evening search: yesterday's date-only ad is in, the day before is out.
  const dayGate = makeGate({ profile, target, plan: { ...plan, max_age_days: 1 }, tickets: [], now: new Date(2026, 10, 7, 21, 19).getTime() });
  assert.strictEqual(dayGate({ ...base, posted: '2026-11-07' }), null);
  assert.strictEqual(dayGate({ ...base, posted: '2026-11-06' }), null);
  assert.strictEqual(dayGate({ ...base, posted: '2026-11-05' }), 'too old');
  assert.strictEqual(dayGate({ ...base, posted: '2026-11-05T20:00:00Z' }), 'too old');
});

test('funnel stages must add up', () => {
  const s = new Stage('x', 3);
  s.keep();
  s.drop('too old');
  assert.throws(() => s.close(), /does not add up/);
  s.miss('robot_check');
  assert.deepStrictEqual(s.close().reasons, { 'too old': 1, 'unread: robot_check': 1 });
});

test('registry is valid and ranking follows country and job type', () => {
  assert.deepStrictEqual(boards.validate(), []);
  const p = profileLib.loadProfile();
  p.location = { ...p.location, city: 'Dresden', country: 'Deutschland', remote: 'no' };
  const de = boards.suggest(p, { id: 't', job_types: ['mini_job'], roles: { scope: 'any', titles: [] } }).map((r) => r.board.id);
  assert.ok(de.indexOf('arbeitsagentur') < 3, de.join(','));
  assert.ok(!de.includes('infojobs_it') && !de.includes('remotive'));
  p.location = { ...p.location, city: 'Rimini', country: 'Italia', remote: 'also' };
  const it = boards.suggest(p, { id: 't', job_types: ['part_time'], roles: { scope: 'any', titles: [] } }).map((r) => r.board.id);
  assert.ok(it.includes('subito_lavoro') && it.includes('indeed') && !it.includes('arbeitsagentur'));
  assert.ok(it.includes('remotive'));
});

test('search plan validation and screening of found jobs', async () => {
  assert.throws(() => planLib.set('t1', { queries: [], boards: ['nope'] }), /unknown board "nope"[\s\S]*search word/);
  const plan = planLib.set('t1', { country: 'IT', queries: ['cameriere'], title_keywords: ['cameriere'], towns: ['Rimini'], boards: ['indeed', { id: 'linkedin', enabled: false }] });
  assert.deepStrictEqual(plan.boards.map((b) => [b.id, b.enabled]), [['indeed', true], ['linkedin', false]]);
  assert.strictEqual(plan.max_age_days, 14);
  assert.strictEqual(planLib.setMaxAge('t1', 7).max_age_days, 7);
  assert.strictEqual(planLib.get('t1').max_age_days, 7);
  assert.throws(() => planLib.setMaxAge('t1', 5), /Choose one of/);
  assert.throws(() => planLib.setMaxAge('nope', 7), /No search plan/);
  planLib.setMaxAge('t1', 14);
  const profile = profileLib.loadProfile();
  profile.location = { ...profile.location, city: 'Rimini', country: 'Italy', remote: 'no' };
  const target = { id: 't1', job_types: ['part_time'], roles: { scope: 'cv', titles: [] } };
  const rows = [
    { source: 'Indeed', native_id: 'a1', title: 'Cameriere', company: 'Hotel Sole', location: 'Rimini', url: 'https://it.indeed.com/viewjob?jk=a1a1a1a1a1a1a1a1', body: AD },
    { source: 'Indeed', native_id: 'a2', title: 'Cameriere', company: 'Hotel Luna', location: 'Napoli', url: 'https://it.indeed.com/viewjob?jk=a2a2a2a2a2a2a2a2', body: AD },
    { source: 'Indeed', native_id: 'a1', title: 'Cameriere', company: 'Hotel Sole', location: 'Rimini', url: 'https://it.indeed.com/viewjob?jk=a1a1a1a1a1a1a1a1', body: AD },
  ];
  const res = await search.screen(rows, { profile, target, plan, run: 'test' });
  assert.strictEqual(res.stages[0].in, 2);
  assert.deepStrictEqual(res.stages[0].reasons, { 'too far away': 1 });
  assert.strictEqual(res.candidates.length, 1);
  assert.strictEqual(postings.get(res.candidates[0]).status, 'candidate');
  assert.match(postings.readBody(res.candidates[0]), /looking for a waiter/);
  const again = await search.screen(rows.slice(0, 1), { profile, target, plan, run: 'test2' });
  assert.strictEqual(again.already_known, 1);
});
