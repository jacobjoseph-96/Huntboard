const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { freshWorkspace } = require('./helpers');

const ws = freshWorkspace('delete');
const store = require('../lib/store');

test('delete moves the folder to trash, keeps the job off the board, and restore puts it back', () => {
  const [t] = store.addTickets([{ title: 'C++ Developer', company: 'secunet Security Networks AG', location: 'Essen',
    link: 'https://www.linkedin.com/jobs/view/4321098765' }]).added;
  const dir = t._dir;
  const rec = store.deleteTicket(t.key, { note: 'not for me' });
  assert.strictEqual(rec.note, 'not for me');
  assert.ok(!fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(ws, 'trash', rec.folder, 'ticket.json')));
  assert.strictEqual(store.getTicket(t.key), null);
  assert.strictEqual(store.listTickets().length, 0);
  assert.deepStrictEqual(store.listDeleted().map((d) => d.key), [t.key]);

  // Found again by a search (same link, or same title + company + town): reported, not added.
  const again = store.addTickets([{ title: 'C++ Developer (m/w/d)', company: 'secunet Security Networks', location: 'Essen' },
    { title: 'Other', company: 'X', link: 'https://www.linkedin.com/jobs/view/4321098765?trk=abc' }]);
  assert.strictEqual(again.added.length, 0);
  assert.ok(again.duplicates.every((d) => d.deleted && d.key === t.key));

  const back = store.restoreTicket(t.key);
  assert.strictEqual(back.key, t.key);
  assert.ok(fs.existsSync(dir));
  assert.deepStrictEqual(back.history.slice(-2).map((h) => h.type), ['deleted', 'restored']);
  assert.strictEqual(store.listDeleted().length, 0);
  assert.throws(() => store.restoreTicket(t.key), /not in the deleted list/);
});
