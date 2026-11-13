// The task text the app gives the AI. It is written to workspace/runs/<id>/prompt.md; the AI tool only
// receives "read that file", so nothing the user typed is ever put on a command line.

const fs = require('fs');
const path = require('path');
const paths = require('../paths');
const store = require('../store');

const TASKS = {
  setup: 'Read my CV and my other documents and fill in my Huntboard profile.',
  'plan-search': 'Make the search plan (job boards, search words, nearby towns) for my search targets.',
  search: 'Search for new jobs for my search targets and add the good ones to the board.',
  'cv-design': 'Copy the look of my own CV, so the CVs you make for me use the same design.',
  tailor: 'Make a CV tailored to this job.',
  'cover-letter': 'Write a cover letter for this job.',
  apply: 'Apply to the jobs in "To apply" as far as my applying setting allows.',
  'interview-prep': 'Prepare me for the next interview round of this job.',
  'interview-debrief': 'Help me debrief the interview I just had for this job.',
  'follow-up': 'Write a short follow-up message for this application.',
};

// "workspace" normally; the absolute path when the workspace lives outside the project folder.
function workspaceRef() {
  const rel = paths.rel(paths.ws());
  return rel.startsWith('..') ? paths.ws().split(path.sep).join('/') : rel;
}

function skillExists(skill) {
  return fs.existsSync(path.join(paths.ROOT, 'agent', 'skills', skill, 'SKILL.md'));
}

function contextLines(run) {
  const out = [];
  if (run.ticket) {
    const t = store.getTicket(run.ticket);
    if (t) out.push(`- Ticket: ${t.key} "${t.title}" at ${t.company || '?'} (folder ${paths.rel(t._dir)}). Read it with \`node tools/hunt.js show ${t.key} --posting\`.`);
  }
  if (run.target) out.push(`- Search target: ${run.target} (see \`node tools/hunt.js profile\`).`);
  if (run.context && run.context.page) out.push(`- The user is looking at the "${run.context.page}" page of the app${run.context.ticket ? ` (ticket ${run.context.ticket})` : ''}.`);
  if (run.args && Object.keys(run.args).length) out.push(`- Options: ${JSON.stringify(run.args)}`);
  return out;
}

// The user's "Instructions for the AI" on the tickets this run works on. They are orders for that job: they win over
// a skill's default (e.g. "a form that keeps a stored CV is Needs you"), never over the hard rules.
function instructionLines(run) {
  let tickets = [];
  if (run.ticket) tickets = [store.getTicket(run.ticket)].filter(Boolean);
  else if (run.skill === 'apply') tickets = store.listTickets().filter((t) => t.status === 'to_apply');
  tickets = tickets.filter((t) => t.instructions && t.instructions.text);
  if (!tickets.length) return [];
  return [
    '## Instructions from the user',
    'The user wrote these for specific jobs. Do what they say for that job, even where a skill says otherwise; the hard',
    'rules in AGENTS.md still hold (no passwords, no picture puzzles, no invented facts).',
    ...tickets.slice(0, 40).map((t) => `- ${t.key} (${t.company || '?'}, ${t.title}): ${t.instructions.text.replace(/\s*\n\s*/g, ' / ')}`),
    '',
  ];
}

function proxyBlock(profile) {
  const a = profile.applying;
  return [
    '## Fully automatic mode: you act for the user',
    'The user chose "fully automatic" and may be away. You are their stand-in for this task:',
    `- Do not wait for confirmations. \`hunt ask\` waits ${a.proxy_wait_seconds} seconds for the user and then tells you to decide yourself.`,
    '- Decide as the user would, from their profile, search targets, form answers and notes on the ticket. Record every real',
    '  decision with `node tools/hunt.js decide "<what and why>" --ticket <KEY>`.',
    `- Apply only to jobs with a fit score of at least ${a.min_fit}%, and to at most ${a.daily_cap} jobs today (count today's "Applied" tickets).`,
    '- Never type passwords and never solve or get around robot checks (captchas, "I am not a robot", Cloudflare).',
    '  When you meet one, or a login, or a question whose answer is not in the user\'s data:',
    '  `node tools/hunt.js needs <KEY> "<what is needed>"`, skip that job and continue with the next one.',
    '- Never invent facts in forms or documents.',
    '- End with a report: what you did (ticket keys), what you skipped and why, what is left for the user ("Needs you"),',
    '  and the decisions you took for them.',
    '',
  ];
}

function build(run, profile) {
  const lang = profile.reply_language || 'English';
  if (run.kind === 'test') {
    return 'Reply with exactly the word OK and nothing else. Do not use any tools.\n';
  }
  const common = [
    '## How to work in the app',
    'You are running inside the Huntboard app in the background. The user sees your progress in the app and cannot type into this session.',
    '- Follow the project rules in AGENTS.md / GEMINI.md / CLAUDE.md (one of them is already loaded).',
    '- To ask the user anything (a choice, a missing fact, "please solve the check in the browser window"), run',
    '  `node tools/hunt.js ask "<question>" --choices "Yes,No"` (choices optional). It waits for the answer and prints it.',
    '  Never wait for terminal input and never ask questions only in your reply text.',
    `- The user's data folder ("workspace") is \`${workspaceRef()}\`. Write temporary files only inside \`${workspaceRef()}/tmp/\` and pass those paths to \`node tools/hunt.js\`.`,
    `- End with a short summary for the user in ${lang} (at most 6 lines, plain language, no technical details).`,
  ];
  if (run.kind === 'chat') {
    return [
      '# Message from the user',
      '',
      run.message,
      '',
      ...(contextLines(run).length ? ['## Context', ...contextLines(run), ''] : []),
      ...instructionLines(run),
      ...common,
      '- If the message asks for one of the Huntboard tasks (setup, search, tailor, cover letter, apply, interview preparation...), use the matching skill.',
      '',
    ].join('\n');
  }
  const skill = run.skill;
  return [
    `# Task: ${TASKS[skill] || skill}`,
    '',
    `Use the Huntboard skill "${skill}". If your tool has a skill or command with that name, use it; otherwise read`,
    `\`agent/skills/${skill}/SKILL.md\` and follow it exactly.`,
    '',
    ...(contextLines(run).length ? ['## Context', ...contextLines(run), ''] : []),
    ...(run.message ? ['## Extra wishes from the user', run.message, ''] : []),
    ...instructionLines(run),
    ...(run.proxy ? proxyBlock(profile) : []),
    ...common,
    '',
  ].join('\n');
}

module.exports = { build, TASKS, skillExists, instructionLines };
