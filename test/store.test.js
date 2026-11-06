const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshWorkspace } = require('./helpers');

freshWorkspace('store');
const store = require('../lib/store');
const inbox = require('../lib/inbox');

test('adds tickets, skips duplicates across boards, saves the ad text', () => {
  const res = store.addTickets([
    { title: 'Cameriere (m/w/d)', company: 'Hotel Rex S.r.l.', location: 'Rimini (RN)', link: 'https://it.indeed.com/viewjob?jk=abc123def4567890&utm_source=x', posting: 'Full ad' },
    { title: 'Cameriere', company: 'Hotel Rex', location: 'Rimini', link: 'https://www.linkedin.com/jobs/view/1234567' },
    { title: 'Barista', company: 'Bar Uno', location: 'Rimini', link: 'https://it.indeed.com/viewjob?jk=abc123def4567890' },
    { company: 'no title' },
  ]);
  assert.strictEqual(res.added.length, 1);
  assert.strictEqual(res.duplicates.length, 2);
  assert.strictEqual(res.invalid.length, 1);
  const t = res.added[0];
  assert.strictEqual(t.key, 'JOB-1');
  assert.strictEqual(t.link, 'https://it.indeed.com/viewjob?jk=abc123def4567890');
  assert.strictEqual(store.readPosting('JOB-1').trim(), 'Full ad');
  assert.ok(fs.existsSync(path.join(t._dir, 'ticket.json')));
});

test('moves keep history and the furthest status never goes back', () => {
  store.moveTicket('JOB-1', 'applied', { by: 'user' });
  let t = store.getTicket('job-1');
  assert.strictEqual(t.status, 'applied');
  assert.ok(t.applied_at);
  store.moveTicket('JOB-1', 'closed', { resolution: 'rejected' });
  t = store.getTicket('1');
  assert.strictEqual(t.status, 'closed');
  assert.strictEqual(t.resolution, 'rejected');
  assert.strictEqual(t.furthest_status, 'applied');
  assert.deepStrictEqual(t.history.filter((h) => h.type === 'status').map((h) => h.to), ['applied', 'closed']);
  assert.throws(() => store.moveTicket('JOB-1', 'nonsense'), /Unknown status/);
});

test('interview rounds, notes and the inbox', () => {
  const { added } = store.addTickets([{ title: 'Receptionist', company: 'Hotel Due', location: 'Riccione' }], { by: 'user', status: 'to_apply' });
  const key = added[0].key;
  store.addInterviewRound(key, { stage: 'technical', at: '2099-01-01T10:00:00Z', interviewers: 'Anna, Marco' });
  store.addNote(key, 'They want weekend availability');
  const t = store.getTicket(key);
  assert.strictEqual(t.status, 'interview');
  assert.strictEqual(t.interview.rounds[0].stage, 'technical');
  assert.deepStrictEqual(t.interview.rounds[0].interviewers, ['Anna', 'Marco']);
  let items = inbox.compute();
  assert.ok(items.some((i) => i.type === 'interview_prep' && i.ticket === key));
  // Once a prep pack exists and the date has passed, the inbox asks for a debrief instead.
  const prep = path.join(t._dir, 'interview', '01-technical');
  fs.mkdirSync(prep, { recursive: true });
  fs.writeFileSync(path.join(prep, '00_START_HERE.md'), '# Prep');
  store.updateRound(key, 1, { prep_dir: 'interview/01-technical', at: '2000-01-01T10:00:00Z' });
  items = inbox.compute();
  assert.ok(!items.some((i) => i.type === 'interview_prep' && i.ticket === key));
  assert.ok(items.some((i) => i.type === 'debrief' && i.ticket === key));
});

test('follow-up reminder after N days without an answer', () => {
  const { added } = store.addTickets([{ title: 'Shop assistant', company: 'Negozio', location: 'Rimini' }], { by: 'user', status: 'applied' });
  const now = Date.now() + 15 * 86400000;
  assert.ok(inbox.compute({ now }).some((i) => i.type === 'follow_up' && i.ticket === added[0].key));
});
