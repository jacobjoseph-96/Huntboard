---
name: search
description: Searches the job boards of the search plan for new jobs, reads the ads, scores how well each fits the user and puts the good ones on the board under "Found". Use when the user says "find jobs", "search", "look for new jobs" or presses Find jobs in the app.
---

# Find jobs

Follow `AGENTS.md`. Never invent facts about a job or the user. Do this for each active search target (or only the
target named in your task).

1. If `node tools/hunt.js plan show --target <id>` says there is no plan, use the `plan-search` skill first.
2. Run `node tools/hunt.js search run --target <id>`. It searches the API boards, drops jobs that are clearly wrong
   (too far, too old, already on the board, the user's "avoid" words, scams), reads the ad texts and prints a report.
3. **Browser boards** listed in the report: search each one with the browser tools, following its playbook in
   `boards/playbooks/`. Use the plan's search words and towns, the first 2 result pages per search word, and open
   the ads that look relevant to copy their full text. Save the jobs as a JSON array in `<workspace>/tmp/` and run
   `node tools/hunt.js ingest <file> --target <id> --source <board id>`. If a board shows a robot check, follow the
   playbook (never get around it). Do not spend more than about 15 minutes on one board.
4. Read the candidates: `node tools/hunt.js candidates --target <id> --json` (max 40 at a time; repeat after adding
   or skipping them). For each one decide **from the ad text and the user's profile**:
   - **Fit score 0–100** and a one-line verdict. For roles `cv`/`custom`: how well the user's experience, skills,
     languages and education match what the ad asks. For roles `any`: can the user realistically do and get this
     job (hours, distance, schedule, language level, licence, physical demands, legal right to work), not their field.
   - `reasons`: 2–4 short facts why it fits (from the ad + the user's data).
   - `red_flags`: e.g. language level higher than the user's, required licence they lack, night shifts they avoid,
     unpaid trial, vague pay, agency without client name, "commission only".
   Skip (do not add) jobs below 35 and anything clearly unsuitable:
   `node tools/hunt.js candidates skip <key> <key> --reason "<short reason>"`.
5. Add the others in one go: write `<workspace>/tmp/new_jobs.json` and run `node tools/hunt.js add <workspace>/tmp/new_jobs.json`:
   ```json
   [{ "pool_key": "<key from candidates>", "title": "…", "company": "…", "location": "…", "mode": "on site | hybrid | remote",
      "job_type": "Part-time", "salary": "as stated, else empty", "target": "<id>",
      "summary": "2–3 sentences: what the job is", "requirements": "requirements separated by ; ",
      "fit": { "score": 78, "verdict": "Good – …", "reasons": ["…"], "red_flags": ["…"], "scored_with": "<your model name>" } }]
   ```
   `pool_key` makes Huntboard keep the full ad text with the ticket. In fully automatic mode, jobs at or above the
   user's minimum fit go straight to "To apply" (the app then starts applying).
6. Reply with a short summary per target: how many jobs were found, filtered out (main reasons), unread, skipped
   by you, added; the top 5 new jobs as `KEY – job – company – town – why it fits`; and boards that need the user
   (keys, robot checks).
