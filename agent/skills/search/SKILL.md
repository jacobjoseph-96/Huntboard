---
name: search
description: Searches the job boards of the search plan for new jobs, reads the ads, scores how well each fits the user and puts the good ones on the board under "Found". Use when the user says "find jobs", "search", "look for new jobs" or presses Find jobs in the app.
---

# Find jobs

Follow `AGENTS.md`. Never invent facts about a job or the user. Do this for each active search target (or only the
target named in your task). Huntboard's commands do the collecting, filtering, reading and a first fit check; your
work is the fit score. Keep your tool output small: use the commands below, not page snapshots or full ad texts.

1. If `node tools/hunt.js plan show --target <id>` says there is no plan, or that the places changed since the plan
   was made, use the `plan-search` skill first.
2. **Company job boards.** Run `node tools/hunt.js discover due --target <id>`. Only if it prints `due`, search the web
   for those sites, as many searches as it says (each: one search word of the plan in quotes + the plan's country
   name, limited to one group of hosts):
   - Greenhouse: `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`
   - Lever: `jobs.lever.co`, `jobs.eu.lever.co` · Ashby: `jobs.ashbyhq.com`
   - Personio: `jobs.personio.de`, `jobs.personio.com` · Recruitee: `recruitee.com`
   - SmartRecruiters: `jobs.smartrecruiters.com`, `careers.smartrecruiters.com`

   Use your search tool's domain filter if it has one, else put the hosts in the query
   (`site:jobs.lever.co OR site:jobs.eu.lever.co "C++ developer" Germany`). Keep only URLs the search returned (never
   make one up), save them as a JSON array of `{ "url": "…", "title": "…" }` in `<workspace>/tmp/`, and run
   `node tools/hunt.js discover add --file <file> --target <id>`. Never take a job or its date from a search page.
3. Run `node tools/hunt.js search run --target <id>`. It searches the boards Huntboard can read itself, drops jobs that
   are clearly wrong (too far, too old, already on the board, the user's "avoid" words, scams, nothing matches the
   CV), reads the ad texts and prints a report with the next commands and the limits for this run.
4. **Browser boards**, only those the report lists, with the search words and page count it gives: follow each
   board's playbook in `boards/playbooks/` (read the cards with its `browser_evaluate` snippet; no screenshots).
   Save the cards as a JSON array in `<workspace>/tmp/` and run
   `node tools/hunt.js ingest <file> --target <id> --source <board id>`. Every job needs its `url`, the full link of the
   ad from the card (never build or guess one). Robot check: follow the playbook, never get around it. At most about
   15 minutes per board.
5. **Score**: `node tools/hunt.js candidates --target <id> --brief` (best first; each job with what the employer asks
   for and what matches the CV). For each one decide **from these lines and the user's profile**:
   - **score 0–100** and a one-line `verdict`. Roles `cv`/`custom`: how well the user's experience, skills,
     languages and education match what the ad asks. Roles `any`: can the user realistically do and get this job
     (hours, distance, schedule, language level, licence, physical demands, right to work), not their field.
   - `reasons`: 2–4 short facts why it fits (from the ad + the user's data).
   - `red_flags`: e.g. a language level above the user's, a licence they lack, night shifts they avoid, unpaid trial,
     vague pay, agency without client name, "commission only".

   Open an ad in full (`hunt candidates show <key>`) only when the short lines are not enough to decide.
6. Write the scores for all of them to `<workspace>/tmp/scores.json` and run
   `node tools/hunt.js score <workspace>/tmp/scores.json --target <id> --model "<your model name>"`:
   ```json
   [{ "key": "<key from candidates>", "score": 78, "verdict": "Good – …", "reasons": ["…"], "red_flags": ["…"] }]
   ```
   Huntboard adds the jobs at 35 or more with their title, company, ad link and text, and skips the rest. In fully
   automatic mode, jobs at or above the user's minimum fit go straight to "To apply". If more candidates are left
   (the brief view says "N of M"), repeat steps 5–6 once.
7. Reply with a short summary per target: how many jobs were found, filtered out (main reasons), skipped by you,
   added; the top 5 new jobs as `KEY – job – company – town – link to the ad – why it fits` (`score` prints the key and
   link of each); and boards that need the user (robot checks, logins).
