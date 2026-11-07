const test = require('node:test');
const assert = require('node:assert');
const { freshWorkspace } = require('./helpers');

freshWorkspace('instructions');
const store = require('../lib/store');
const prompts = require('../lib/ai/prompts');
const profileLib = require('../lib/profile');

const TEXT = 'It is fine to replace the stored CV on StepStone: remove it, then attach the new one.';

test('instructions are saved, replaced, logged once and cleared', () => {
  const [t] = store.addTickets([{ title: 'Software Engineer', company: 'Smiths Detection', status: 'to_apply' }]).added;
  store.setInstructions(t.key, TEXT);
  let got = store.getTicket(t.key);
  assert.strictEqual(got.instructions.text, TEXT);
  assert.strictEqual(got.instructions.by, 'user');
  store.setInstructions(t.key, TEXT); // same text: no second history entry
  got = store.getTicket(t.key);
  assert.strictEqual(got.history.filter((h) => h.type === 'instructions').length, 1);
  store.setInstructions(t.key, '  ');
  got = store.getTicket(t.key);
  assert.strictEqual(got.instructions, null);
  assert.match(got.history.slice(-1)[0].text, /Removed/);
});

test('the run prompt carries the instructions of its ticket, and "apply" those of every To-apply ticket', () => {
  const [a] = store.addTickets([{ title: 'C++ Developer', company: 'Acme', status: 'to_apply' }]).added;
  const [b] = store.addTickets([{ title: 'Qt Developer', company: 'Beta', status: 'found' }]).added;
  store.setInstructions(a.key, TEXT);
  store.setInstructions(b.key, 'Write the letter in German.');
  const profile = profileLib.loadProfile();
  const one = prompts.build({ kind: 'skill', skill: 'cover-letter', ticket: b.key }, profile);
  assert.match(one, /## Instructions from the user/);
  assert.match(one, /Write the letter in German/);
  assert.doesNotMatch(one, /StepStone/);
  const all = prompts.build({ kind: 'skill', skill: 'apply' }, profile);
  assert.match(all, new RegExp(`${a.key} \\(Acme`));
  assert.doesNotMatch(all, /Write the letter in German/); // b is not in To apply
  const none = prompts.build({ kind: 'skill', skill: 'search' }, profile);
  assert.doesNotMatch(none, /Instructions from the user/);
});
