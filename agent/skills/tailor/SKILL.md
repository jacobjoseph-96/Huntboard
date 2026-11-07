---
name: tailor
description: Makes a CV tailored to one job on the board, in the job's language, so the most relevant real experience is first and uses the ad's words. Use when the user says "tailor my CV for JOB-12", presses Tailor my CV, or as part of applying.
---

# Tailor the CV to one job

Follow `AGENTS.md`. Tailoring means **choosing and wording**, never adding: every skill, number, tool, title and
certificate must come from the user's CV, documents, profile or notes on the ticket.

1. Read the job: `node tools/hunt.js show <KEY> --posting` (follow its `INSTRUCTIONS FROM THE USER`, if any). Note the language of the ad, the must-haves, the
   nice-to-haves and the exact words the ad uses for them. Read the notes on the ticket: they are facts and wishes
   from the user.
2. Read the user's data: `node tools/hunt.js cv show`, `node tools/hunt.js profile`, and the texts of relevant
   documents (`docs list`, `docs text <id>`).
3. Check the custom of the job's country in `agent/skills/cv/countries.md`.
4. Write the changes for this job to `<workspace>/tmp/<KEY>_cv.json`:
   ```json
   { "title": "the ad's job title if it truthfully fits the user",
     "summary": "2–3 sentences that connect the user's real strengths to this job",
     "skills": [{ "group": "…", "items": ["the user's own skills, the ones the ad asks for first"] }],
     "experience": [{ "company": "exact company name from the CV", "bullets": ["reworded real bullets, most relevant first, 2–4 per job"] }],
     "order": ["company names in the order to show, most relevant first (optional)"],
     "hide_sections": ["references"] }
   ```
   If the ad's language differs from the structured CV's language, instead write a complete translated and tailored
   CV to `<ticket folder>/docs/cv_<lang>.json` (same format as `cv show`) and render with `--cv` (no `--overrides`).
5. Fact check: `node tools/hunt.js factcheck <your json> --ticket <KEY>`. Fix every item it lists.
6. Render: `node tools/hunt.js cv render --ticket <KEY> --lang <lang> --overrides <workspace>/tmp/<KEY>_cv.json`
   (or `--cv <file>`), plus `--photo yes` / `--birth-date` / `--nationality` only where the country expects it.
   Keep it to one page for entry-level and side jobs, two pages at most otherwise; shorten and render again if needed.
7. Tell the user in two lines what you emphasised and where the PDF is (the ticket's Documents tab).
