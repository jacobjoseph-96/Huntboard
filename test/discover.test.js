// Company boards found by a web search: URL -> board, names from result titles, the plan keeps them
// once, and a search polls every known board. No network: the board API answer is stubbed.
const test = require('node:test');
const assert = require('node:assert');
const { freshWorkspace } = require('./helpers');

freshWorkspace('discover');
const http = require('../lib/http');
const C = require('../lib/collectors');
const planLib = require('../lib/plan');

test('board URLs, EU hosts included', () => {
  assert.deepStrictEqual(C.atsFromUrl('https://job-boards.eu.greenhouse.io/isaraerospace/jobs/123'), { ats: 'greenhouse', slug: 'isaraerospace' });
  assert.deepStrictEqual(C.atsFromUrl('https://job-boards.greenhouse.io/acme'), { ats: 'greenhouse', slug: 'acme' });
  assert.deepStrictEqual(C.atsFromUrl('https://jobs.eu.lever.co/mobileye/abc'), { ats: 'lever_eu', slug: 'mobileye' });
  assert.deepStrictEqual(C.atsFromUrl('https://jobs.lever.co/acme/abc'), { ats: 'lever', slug: 'acme' });
  assert.deepStrictEqual(C.atsFromUrl('https://jobs.ashbyhq.com/vector/x'), { ats: 'ashby', slug: 'vector' });
  assert.deepStrictEqual(C.atsFromUrl('https://brainlab.jobs.personio.de/job/1'), { ats: 'personio', slug: 'brainlab' });
  assert.deepStrictEqual(C.atsFromUrl('https://careers.smartrecruiters.com/Bosch'), { ats: 'smartrecruiters', slug: 'Bosch' });
  assert.strictEqual(C.atsFromUrl('https://example.com/jobs'), null);
  assert.ok(C.ATS.lever_eu('m').startsWith('https://api.eu.lever.co/'));
  const eu = C.parseAts('lever_eu', JSON.stringify([{ id: 'a', text: 'C++ Dev', categories: { location: 'Berlin' }, hostedUrl: 'https://jobs.eu.lever.co/m/a', createdAt: 1759708800000 }]), 'm', 'M');
  assert.deepStrictEqual([eu.length, eu[0].posted], [1, '2025-10-06']);
  assert.strictEqual(C.atsOrgName('greenhouse', JSON.stringify({ jobs: [{ company_name: 'Isar Aerospace SE' }] })), 'Isar Aerospace SE');
});

test('employer names from search-result titles', () => {
  const { nameFromTitle } = require('../lib/discover');
  assert.strictEqual(nameFromTitle('Jobs at Isar Aerospace SE'), 'Isar Aerospace SE');
  assert.strictEqual(nameFromTitle('Mobileye jobs'), 'Mobileye');
  assert.strictEqual(nameFromTitle('C++ Developer - Sonar - Lever'), 'Sonar');
  assert.strictEqual(nameFromTitle('Softwareentwickler C++ (m/w/d) | ACME GmbH'), 'ACME GmbH');
  assert.strictEqual(nameFromTitle('Search - Myworkdayjobs.com'), '');
});

test('discover add: checked against the board API, kept once in the plan', async () => {
  planLib.set('t1', { country: 'DE', queries: ['C++'], boards: ['indeed'], companies: [{ name: 'ACME', ats: 'lever', slug: 'acme' }, { name: 'ACME', ats: 'lever', slug: 'ACME' }] });
  assert.strictEqual(planLib.get('t1').companies.length, 1, 'one entry per board');
  const real = http.request;
  const answers = {
    'https://boards-api.greenhouse.io/v1/boards/isaraerospace/jobs?content=true': { status: 200, text: JSON.stringify({ jobs: [{ id: 1, title: 'C++ Engineer', company_name: 'Isar Aerospace SE', location: { name: 'Munich' } }] }) },
    'https://api.eu.lever.co/v0/postings/empty?mode=json': { status: 200, text: '[]' },
  };
  http.request = async (url) => answers[url] || { status: 404, text: '' };
  try {
    const discover = require('../lib/discover');
    const res = await discover.addToPlan('t1', discover.readUrls(JSON.stringify([
      'https://job-boards.eu.greenhouse.io/isaraerospace/jobs/1',
      'https://job-boards.eu.greenhouse.io/isaraerospace/jobs/2',
      'https://jobs.eu.lever.co/empty/x',
      'https://jobs.lever.co/acme/y',
      'https://example.com/jobs',
    ])), { date: '2026-11-08' });
    assert.deepStrictEqual(res.added.map((a) => [a.name, a.ats, a.slug, a.found, a.jobs]), [['Isar Aerospace SE', 'greenhouse', 'isaraerospace', 'search 2026-11-08', 1]]);
    assert.deepStrictEqual(res.skipped.map((s) => s.reason), ['no postings on the board', 'lever/acme is already in the plan', 'not a company board Huntboard can read']);
    const saved = planLib.get('t1').companies;
    assert.deepStrictEqual(saved.map((c) => c.name), ['ACME', 'Isar Aerospace SE']);
    assert.strictEqual(saved[1].found, 'search 2026-11-08');
    const again = await discover.addToPlan('t1', [{ url: 'https://job-boards.greenhouse.io/isaraerospace' }]);
    assert.strictEqual(again.added.length, 0);
  } finally {
    http.request = real;
  }
});

test('a search reads every company with a known board, guesses only 30', async () => {
  const companies = [
    ...Array.from({ length: 45 }, (_, i) => ({ name: `Known ${i}`, ats: 'greenhouse', slug: `known${i}` })),
    ...Array.from({ length: 40 }, (_, i) => ({ name: `Guess ${i}` })),
  ];
  const real = http.request;
  const asked = new Set();
  http.request = async (url) => {
    asked.add(url);
    return { status: 404, text: '' };
  };
  try {
    const res = await C.COLLECTORS.ats({ companies, title_keywords: [], queries: [], remote: 'yes', city: 'Berlin', country: 'DE', radius_km: 50, towns: [], cities: [] });
    assert.strictEqual(res.coverage.filter((l) => /^Known /.test(l)).length, 45);
    assert.strictEqual(res.coverage.filter((l) => /^Guess /.test(l)).length, 30);
    assert.ok(asked.has('https://boards-api.greenhouse.io/v1/boards/known44/jobs?content=true'));
  } finally {
    http.request = real;
  }
});
