---
name: cover-letter
description: Writes a one-page cover letter for one job on the board, in the job's language and the country's style, from the user's real experience. Use when the user says "cover letter for JOB-12", presses Write a cover letter, or as part of applying.
---

# Write a cover letter

Follow `AGENTS.md`: only facts from the CV, documents, profile, ticket notes and the ad.

1. Read the job (`node tools/hunt.js show <KEY> --posting` (follow its `INSTRUCTIONS FROM THE USER`, if any)), the user (`cv show`, `profile`) and the country's style
   in `agent/skills/cv/countries.md`. Use the ad's language.
2. Read `agent/skills/cover-letter/style.md`. It is the method for every letter: five short paragraphs with one
   task each, what never to write, and the swap test.
3. Write `<workspace>/tmp/<KEY>_letter.json`, about 200–300 words in total:
   ```json
   { "language": "it",
     "recipient": { "company": "…", "contact": "only if the ad names a person", "address_lines": ["only if in the ad"] },
     "subject": "Application for … (reference code if the ad has one)",
     "salutation": "the country's formal greeting; use the contact's name if known",
     "paragraphs": [
       "1 the hook: the exact job, the team if the ad names it, the one concrete thing in this ad that made the user apply",
       "2 why this company: one concrete fact about them, tied to the user",
       "3 main proof: one project or job from the CV: what it was, what was hard, what the user did, what came of it",
       "4 second proof: a different job, course or side role that covers another requirement of the ad",
       "5 the close: what the ad asks and is not said yet (start date, hours, language, relocation), and a confident request for a conversation"
     ],
     "closing": "the country's formal closing" }
   ```
   The user's name, contact and the date are added automatically. No enclosure line is printed. A short list
   (`"bullets": [{ "label": "…", "text": "…" }]`, shown after paragraph 1) is only for an ad or a country that
   wants one; normally leave it out.
4. Do the swap test from `style.md`: if the letter would also fit a competitor, rewrite paragraphs 1 and 2.
5. Fact check: `node tools/hunt.js factcheck <workspace>/tmp/<KEY>_letter.json --ticket <KEY>`; fix every item.
6. Render: `node tools/hunt.js letter render <workspace>/tmp/<KEY>_letter.json --ticket <KEY> --lang <lang>`.
   It must be one page; shorten and render again if not.
7. Tell the user where it is and how to apply (link or e-mail address from the ad).
