---
name: cover-letter
description: Writes a one-page cover letter for one job on the board, in the job's language and the country's style, from the user's real experience. Use when the user says "cover letter for JOB-12", presses Write a cover letter, or as part of applying.
---

# Write a cover letter

Follow `AGENTS.md`: only facts from the CV, documents, profile, ticket notes and the ad.

1. Read the job (`node tools/hunt.js show <KEY> --posting`), the user (`cv show`, `profile`) and the country's style
   in `agent/skills/cv/countries.md`. Use the ad's language.
2. Write `<workspace>/tmp/<KEY>_letter.json`, about 220–320 words in total:
   ```json
   { "language": "it",
     "recipient": { "company": "…", "contact": "only if the ad names a person", "address_lines": ["only if in the ad"] },
     "subject": "Application for … (reference code if the ad has one)",
     "salutation": "the country's formal greeting; use the contact's name if known",
     "paragraphs": [
       "1: which job, where you saw it, why this job and this company (something specific from the ad)",
       "2: (after the bullets) languages, work permit if relevant, availability / start date, the hours you can work",
       "3: a short polite close asking for an interview"
     ],
     "bullets": [{ "label": "strength the ad asks for", "text": "concrete proof from the CV" }],
     "closing": "the country's formal closing" }
   ```
   The bullets (3–4) come between paragraph 1 and paragraph 2. The user's name, contact and the date are added
   automatically. Do not mention salary unless the ad asks for it and the profile has an expectation.
3. Fact check: `node tools/hunt.js factcheck <workspace>/tmp/<KEY>_letter.json --ticket <KEY>`; fix every item.
4. Render: `node tools/hunt.js letter render <workspace>/tmp/<KEY>_letter.json --ticket <KEY> --lang <lang>`.
   It must be one page; shorten and render again if not.
5. Tell the user where it is and how to apply (link or e-mail address from the ad).
