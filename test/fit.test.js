const test = require('node:test');
const assert = require('node:assert');
const { freshWorkspace } = require('./helpers');

freshWorkspace('fit');
const store = require('../lib/store');

test('fit is always a 0-100 percent; an outside ranking score is kept apart as rank', () => {
  const [a, b] = store.addTickets([
    { title: 'ML Engineer', company: 'Imnoo AG', fit: { score: 75, rank: 106, verdict: 'APPLY', scored_with: 'pipeline match (screen.py)' } },
    { title: 'Qt Developer', company: 'Beta', fit: { score: 140, verdict: 'Good' } },
  ]).added;
  assert.strictEqual(a.fit.score, 75);
  assert.strictEqual(a.fit.rank, 106);
  assert.strictEqual(store.fitLabel(a.fit), '75%');
  assert.strictEqual(b.fit.score, 100);
  assert.strictEqual(b.fit.rank, undefined);
  assert.strictEqual(store.fitLabel(null), '-');
});
