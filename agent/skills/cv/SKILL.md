---
name: cv
description: Makes the user's general CV as a one-page PDF in the language and style of the country they apply in, from the structured CV. Use when the user says "make my CV", "my CV in Italian/German…", or before applying when no CV exists in that language.
---

# Make the general CV

Follow `AGENTS.md`: never invent facts. The layout is fixed; you only write data.

1. If `node tools/hunt.js cv show` says there is no structured CV, use the `setup` skill first.
2. Decide the language: the user's request, else `documents_language` in the profile, else the language of the
   country they search in (`node tools/hunt.js plan show`). Read `agent/skills/cv/countries.md` for that
   country's customs (photo, date of birth, length, attachments).
3. If the language is the same as the structured CV, render it directly. Otherwise translate the **whole** CV into
   that language: write `<workspace>/profile/cv_<lang>.json` (same format as `cv show`; job titles as employers in
   that country write them, language names in that language, dates unchanged) and pass it with `--cv`.
4. Render: `node tools/hunt.js cv render --lang <it|de|fr|es|pt|nl|pl|en> [--cv <file>] [--photo yes] [--birth-date] [--nationality]`
   (options only as the country's customs say and only if the data exists).
   - **Design and photo are the user's choice** (Profile page; `cv.template` and `cv.photo` in the profile). The
     render uses them by itself and prints which design it used. `--photo yes` matters only while the user's photo
     setting is "as usual in the country"; "always" and "never" win. Pass `--template <id>` only when the user asks
     for another design (`node tools/hunt.js cv templates` lists them; `own` is the look of their own CV, made by
     the `cv-design` skill).
   - Jobs and education always print **newest first**, and languages as "Language: level".
5. If it prints more than one page for an entry-level or side job (or more than two otherwise), shorten: fewer
   bullets, older jobs in one line, drop minor skills, and render again.
6. Run `node tools/hunt.js factcheck <the json you rendered>`. Fix every listed item (or ask the user).
7. Tell the user where the PDF is and what they should check (contact details, anything you were unsure about).
