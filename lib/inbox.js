// "What needs the user (or the AI) now": the Home page and `hunt inbox` both use this.

const fs = require('fs');
const path = require('path');
const store = require('./store');
const profileLib = require('./profile');
const documents = require('./documents');
const asks = require('./ai/ask');
const proxy = require('./proxy');

const DAY = 86400000;

function lastStatusChange(t) {
  return Date.parse(t.status_changed_at || t.applied_at || t.created_at || 0) || 0;
}

function hasFiles(dir) {
  try {
    return fs.readdirSync(dir).some((f) => /\.(md|pdf|html)$/i.test(f));
  } catch {
    return false;
  }
}

function compute({ now = Date.now() } = {}) {
  const items = [];
  const profile = profileLib.loadProfile();
  const settings = profileLib.loadSettings();
  const docs = documents.list();
  const tickets = store.listTickets();

  for (const a of asks.listPending()) {
    items.push({ type: 'ask', priority: 0, ask_id: a.id, ticket: a.ticket, title: 'The AI is waiting for your answer', text: a.question });
  }

  const missing = profileLib.missing(profile, docs);
  if (missing.length) {
    const what = { cv: 'upload your CV', location: 'set where you live', targets: 'choose what jobs you want' };
    items.push({ type: 'setup', priority: 1, title: 'Finish your profile', text: `Please ${missing.map((m) => what[m]).join(', ')}.`, missing });
  }

  for (const t of tickets) {
    if (t.needs && t.status !== 'closed') {
      items.push({ type: 'needs_you', priority: 1, ticket: t.key, title: `Needs you: ${t.company || t.title}`, text: t.needs.text });
    }
    if (t.status === 'interview') {
      const rounds = (t.interview && t.interview.rounds) || [];
      const r = rounds[rounds.length - 1];
      if (r) {
        const prepDir = r.prep_dir ? path.join(t._dir, r.prep_dir) : null;
        const at = Date.parse(r.at) || null;
        if (!prepDir || !hasFiles(prepDir)) {
          items.push({
            type: 'interview_prep', priority: 2, ticket: t.key, round: r.n, stage: r.stage, at: r.at || null,
            title: `Prepare: ${store.stageLabel(r.stage)} at ${t.company || t.title}`,
            text: r.at ? `Interview ${new Date(r.at).toLocaleString()}` : 'Date not set yet',
            command: `interview-prep ${t.key}`, skill: 'interview-prep',
          });
        } else if (at && at < now && !r.debrief) {
          items.push({
            type: 'debrief', priority: 2, ticket: t.key, round: r.n, stage: r.stage,
            title: `How did it go at ${t.company || t.title}?`,
            text: 'Write down the questions you were asked. The AI turns them into better answers, a thank-you note and the plan for the next round.',
            command: `interview-debrief ${t.key}`, skill: 'interview-debrief',
          });
        }
      }
    }
    if (t.status === 'offer' && !hasFiles(path.join(t._dir, 'interview', 'offer'))) {
      items.push({ type: 'offer_prep', priority: 2, ticket: t.key, title: `Offer from ${t.company}: prepare the negotiation`, command: `interview-prep ${t.key}`, skill: 'interview-prep' });
    }
    if (t.status === 'applied') {
      const days = Math.floor((now - lastStatusChange(t)) / DAY);
      const last = (t.history || []).slice().reverse().find((h) => h.type === 'followup');
      const since = last ? Math.floor((now - Date.parse(last.at)) / DAY) : days;
      if (days >= settings.followup_days && since >= settings.followup_days) {
        items.push({
          type: 'follow_up', priority: 3, ticket: t.key, days,
          title: `No answer from ${t.company || t.title} for ${days} days`,
          text: 'Send a short follow-up, or close the ticket.', command: `follow-up ${t.key}`, skill: 'follow-up',
        });
      }
    }
  }

  // Fully automatic mode: what the AI decided for the user in the last 24 hours.
  const since = new Date(now - DAY).toISOString();
  const decided = proxy.listDecisions({ since });
  if (decided.length) {
    items.push({ type: 'decisions', priority: 3, count: decided.length, title: `The AI took ${decided.length} decision${decided.length > 1 ? 's' : ''} for you`, text: decided.slice(-2).map((d) => d.text).join(' · ') });
  }

  const found = tickets.filter((t) => t.status === 'found');
  if (found.length) items.push({ type: 'review_found', priority: 4, count: found.length, title: `${found.length} new job${found.length > 1 ? 's' : ''} to review`, text: 'Move the ones you like to "To apply", close the others.' });
  const toApply = tickets.filter((t) => t.status === 'to_apply');
  if (toApply.length && profile.applying.mode !== 'off') {
    items.push({ type: 'apply_ready', priority: 5, count: toApply.length, title: `${toApply.length} job${toApply.length > 1 ? 's' : ''} ready to apply`, command: 'apply', skill: 'apply' });
  }
  return items.sort((a, b) => a.priority - b.priority);
}

module.exports = { compute };
