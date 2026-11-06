---
name: plan-search
description: Chooses the best job boards, search words and nearby towns for each of the user's search targets, based on their CV, job type and where they live, and saves the search plan. Use when the user says "choose job boards", "plan my search", before the first search, or when the profile or targets changed.
---

# Plan the search

Follow `AGENTS.md`. Do one plan per active search target (or only the target named in your task).

1. Read `node tools/hunt.js profile` and `node tools/hunt.js cv show` (if there is a structured CV).
2. For the target, run `node tools/hunt.js boards suggest --target <id> --json`. It ranks the known boards for the
   country, the job type and the field. Read each board's `reasons` and `notes`.
3. **Choose 3–8 boards.** Prefer boards with `kind: api` (Huntboard reads them itself) plus the 1–3 best `browser`
   boards for this country and kind of job. Skip boards that need a key the user does not have (`usable: false`),
   but mention them in your summary (the user can add a free key to the `.env` file).
   If the country has fewer than 3 good boards, search the web for the main job boards of that country and of this
   kind of work (e.g. "best job sites for part-time jobs in Portugal"). Add each good one with
   `node tools/hunt.js boards add <file.json>` (fields: `id`, `name`, `url`, `countries`, `sectors`, `job_types`,
   `access: {"kind":"browser","playbook":"generic"}`, `priority`, `notes`), then use it in the plan.
4. **Search words** (`queries`, 3–8), in the language of the job country first, then English if useful:
   - roles `cv` (jobs in my field): the job titles from `suggested_roles` and the CV, as employers write them in ads
     (e.g. "Softwareentwickler C++", "C++ Developer"; "Cameriere di sala", "Cameriere").
   - roles `any` (any job of this type): broad words for the job type in the local language, not tied to the
     user's field: e.g. Germany mini-job → "Minijob", "Aushilfe", "Teilzeit";
     Italy part-time → "part time", "stagionale", "weekend", "addetto"; UK → "part time", "weekend", "temporary".
     Add the 3–5 most common entry-level jobs nearby (shops, bars, hotels, warehouses, cleaning, delivery…),
     but leave out what the user wants to avoid.
   - roles `custom`: the user's titles, translated and with common variants.
   Also fill `title_keywords`: single words a matching job title contains (used to filter results), and
   `exclude_keywords`: words that mean the job is wrong (e.g. "senior", "Ausbildung" if not wanted). For `any`
   targets leave `title_keywords` empty.
5. **Towns** (`towns`): the user's city and the towns within the radius (`location.radius_km`, or the target's own
   location), the way they are written in ads, at most 40. If remote work is allowed, add "Remote".
6. **Companies** (optional): if the user named employers they want, or the field has well-known local employers,
   list up to 20 as `{"name": "…"}`; Huntboard checks their career pages itself.
7. Write the plan to `<workspace>/tmp/plan_<target>.json` and save it:
   `node tools/hunt.js plan set <workspace>/tmp/plan_<target>.json --target <id>`
   ```json
   { "country": "IT", "queries": ["…"], "title_keywords": ["…"], "exclude_keywords": [], "towns": ["…"],
     "languages": ["Italian", "English"], "max_age_days": 14,
     "boards": [{ "id": "indeed", "why": "most ads in Italy" }, { "id": "subito_lavoro", "why": "local part-time jobs" }],
     "companies": [], "notes": "…" }
   ```
8. Reply with a short summary per target: the boards and why, the search words, and anything the user can do to get
   more results (e.g. a free key for a board).
