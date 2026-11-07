# Changelog

## Unreleased

- "Instructions for the AI" box on every ticket, read by every AI task on that job (also `hunt instruct`); "Tell the
  AI" on a "Needs you" banner answers it and tries again. Full file paths on tickets with Copy path and Show in folder.
- Job ad details: saving or fetching the ad text fills the empty Location, On site / hybrid / remote, Job type,
  Salary, Apply by and Contact fields. "Fetch the ad" on the Job ad tab reads it from its link (LinkedIn guest page,
  Arbeitsagentur, schema.org JobPosting).
- Board sort: newest / oldest found, applied, last changed, newest ad, apply-by, fit, company, title, ticket number.
- Back / Forward buttons in the sidebar; the board keeps each column's scroll when you come back from a ticket.
- Delete a job from the board (folder to `workspace/trash/`, kept off by later searches); `hunt delete` /
  `hunt restore` bring it back.

## 0.1.0 (first public version)

- Local app in its own window: Home / to-do, Find jobs, Board, tickets, Profile & documents, Settings, chat with the
  AI, AI activity, setup wizard.
- Works with the AI tool you already have: Claude Code and Antigravity CLI (tested), Gemini CLI, Codex CLI, OpenCode
  (any model, also local), GitHub Copilot CLI, Cursor CLI (experimental). One source of instructions for all of them.
- The AI runs in the background and asks you questions through dialogs in the app.
- Search targets with job type and "which jobs": from my CV, any job of this type, or my own list of roles.
- Job board registry (44 boards in 20+ countries) and automatic choice of boards, search words and nearby towns.
- Search engine: LinkedIn, Bundesagentur für Arbeit, Arbeitnow, Adzuna, Jooble, EURES, Remotive, Remote OK and
  company career pages read directly; browser playbooks for Indeed, InfoJobs, Subito and any other board; duplicate
  detection across boards; clear filter reasons; fit score with reasons and red flags.
- Documents: CV in the language and style of the job's country, tailored per job, cover letters, attachments PDF,
  e-mail drafts, fact check against your own data.
- Applying modes: prepare only, fill in forms, apply after one OK, fully automatic (with a decisions log and a
  "Needs you" list).
- Interview preparation per interview step, debriefs with a thank-you draft, follow-up reminders.
- Import of the old one-sheet job list spreadsheet; export to a spreadsheet.
