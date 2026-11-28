# Changelog

## Unreleased

- **Searches find the other names of a job.** A search for "C++ developer" also looks for "C++ software engineer",
  "C++ programmer", "C++ Entwickler"… (`lib/roles.js`; `hunt plan show` lists them as "also searched", the Search
  page shows all search words). "C++", "C#" and ".NET" no longer vanish in the title filter. LinkedIn is now searched
  in every place of the plan, not only the first one.
- **One "Tell the AI what to do" button** on a ticket replaces "Add instructions". It opens a box for your own
  words: "Send to the AI" has exactly that done now and nothing else; "Just remember it" saves it as a rule every
  later AI task on this job follows (shown on the ticket, with Remove). Nothing starts until you wrote something;
  the Needs-you banner uses the same box. A task button pressed just as the page redraws is ignored, so
  a shifting page cannot start a cover letter by mistake.
- **Every job keeps the real link to its ad, with every AI tool.** `hunt add` takes the link from the search pool,
  resolves links copied from a card (`/rc/clk?jk=…`), refuses `#`, home pages and non-URLs, and an AI run cannot
  skip the check with `--by user`; `hunt set … link=` cannot remove a link. The AI gives the ticket key and ad link
  of every job it names.
- **Search on a free or student plan (Antigravity, Gemini).** Huntboard does the work, the AI only scores:
  - StepStone, Reed, karriere.at, jobs.ch and HelloWork are read by Huntboard itself (`html` collector) instead of
    by the AI's browser;
  - a quick fit check in code (`lib/prescore.js`) sorts the candidates and drops the ones where nothing matches the
    CV or a language the user does not speak is required;
  - `hunt candidates --brief` shows each job in a few lines (what the employer asks for, what matches the CV), and
    `hunt score` takes only the scores: Huntboard builds the tickets with title, company, ad link and text;
  - Settings → AI tool → "Save AI usage" (automatic for Gemini / Antigravity) caps the jobs scored per run, the
    browser boards, pages and search words, runs the company-board web search weekly, and uses the light model.

## 0.2.1

- **The AI usage limit no longer loses work.** When the AI tool says its usage limit is reached, the task waits for
  the reset (shown as "waiting for AI limit" with the time it continues) and then carries on in the same AI session
  where it stopped, instead of failing. While the limit lasts, other queued tasks wait too rather than failing one
  after another. Gives up after 3 waits on the same task.
- **Stop works on a waiting task**: it cancels it for good.

## 0.2.0

- **Update with one click, keep everything.** Settings → Updates (or `update.bat` / `sh update.sh` /
  `node tools/hunt.js update`) gets the newest Huntboard: with git it pulls, a downloaded copy gets the newest
  files. Your data in `workspace/` and your `.env` are never touched; a backup is made first (`workspace/backups/`,
  last 3 kept), then the app restarts by itself. The sidebar shows "update ready" when there is a new version.
  One-time data changes of a new version run by themselves (`lib/migrate.js`).
- **Take the photo from my CV**: on the Profile page, one click takes the photo out of the CV you uploaded (PDF or
  Word); logos and icons are skipped.
- **Use my CV as it is**: a ticket button, and Settings → Applying → "Which CV to send", to send the CV you uploaded
  unchanged instead of a tailored one (`hunt cv use-original --ticket KEY`).
- **Write an e-mail**: a ticket button and the new `email` skill: a short application e-mail in the job's language,
  as a draft with your CV and letter attached (`Application_email.eml`) and as text to copy.
- **No invented facts in your CV.** The fact check now knows that the job ad is not the user's data: a skill, tool
  or acronym only the ad has, an employer that is not in your CV, or more jobs than you have are refused, and
  `cv render` / `letter render` do not make a document until it is fixed. Every writing task repeats the truth
  rules in its prompt (some models skim long rule files).
- **Sounds like you.** Invisible characters (zero-width spaces, soft hyphens, odd spaces) are removed from every
  CV, letter and e-mail, which also helps online forms read them. The fact check prints style hints (AI clichés in
  five languages, em dashes, sentences all of one length), and the writing rules ask for the user's own words.
- **Several places per search**: "Search for jobs in" takes cities and regions ("Berlin, Leipzig, Sachsen,
  Niedersachsen"). Each place is searched; regions are searched as a whole on LinkedIn and around their main cities
  on the other boards. "Sachsen" no longer matches "Niedersachsen".
- **Every ticket keeps the link to its ad.** Jobs added from a search lost their link; they keep it now, a job
  without a link is not added, and the links of existing tickets are put back.
- **Settings save themselves**, a moment after you type and when you switch tab or leave the page; nothing is lost
  any more. A **Clear** button empties a tab. The Profile page saves by itself too.
- An unnamed search shows its name as a grey hint, so you can just type.
- **The right model for each task** (Settings → AI tool → Models): a light model for simple tasks, a strong one for
  CVs, letters and interviews, so your usage limit lasts longer. Claude Code: "Use the suggested models".

### Also in 0.2.0 (changes since 0.1.0)

- CV designs: six ready-made templates (Classic, Modern, Sidebar, Tabular / German style, Academic and medical,
  Creative) and "My own design", which the new `cv-design` skill copies from the CV you uploaded. Choose one on the
  Profile page, with a preview of your own CV; `hunt cv templates`, `cv render --template <id>`,
  `cv design init | check`. Classic (one column, skills on top, dates on the right) is the new default.
- CV photo: its own place on the Profile page (add, change, remove; "as usual in the country / always / never").
  The photo sits at the top right and is made small automatically, so it does not bloat every PDF.
- A CV always prints jobs and education newest first; tailoring can no longer reorder them.
- Languages print as "English: C1 · German: B1". A CV file written with other key names (`title`, `language`,
  contact details at the top level) is read correctly instead of printing half-empty lines.
- New optional CV fields: `contact.extra` (header lines such as "Available immediately"), `experience[].tech`,
  `education[].recognition` (a degree recognition prints under its degree, not as a certificate) and `note`.
- The text inside a CV PDF is in reading order (title, dates, employer, details), which is what application forms read.
- Cover letters follow one method (`agent/skills/cover-letter/style.md`): five short paragraphs, no stock opening,
  no praise without a fact, the swap test. Application and follow-up e-mails use the same rules.
  No "Enclosures: CV" line any more.
- Back / Forward buttons line up with the menu icons when the window is narrow.

- Company boards from a web search: once a day the search skill web-searches the Greenhouse, Lever, Ashby,
  Personio, Recruitee and SmartRecruiters hosts with your search word; `hunt discover add <url…> | --file` checks
  each board against its API and adds the ones with postings to the plan (`hunt discover due` says whether today's
  search is still to do). EU boards (`job-boards.eu.greenhouse.io`, `jobs.eu.lever.co`) are read too.
- A search reads every company with a known board (4 at a time); the 30-company cap is only for guessing boards.
  A plan keeps up to 200 companies, one per board.
- Find jobs: "Jobs posted in the last …" picker on each search (day, 3 days, week, 2 weeks, month, 2 months).
  Widening it brings back ads that an earlier search dropped only as too old.
- A date-only "posted" (Arbeitsagentur, EURES) counts as a calendar day: a 1-day search keeps yesterday's ads
  instead of dropping them as 40+ hours old in the evening.
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
