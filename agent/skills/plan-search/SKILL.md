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
4. **Search words** (`queries`, 4–12), in the language of the job country first, then English if useful. For every
   title the user typed or the CV shows, add the other names employers use **for the same job** (not other jobs):
   synonyms of the role word (developer / engineer / programmer, waiter / server, cook / chef), with and without
   "software", and the local-language titles. E.g. "C++ developer" in Germany → "C++ Entwickler",
   "Softwareentwickler C++", "C++ Developer", "C++ Software Engineer", "C++ Programmierer". No seniority words
   ("Senior", "Lead") unless the user wrote them. Huntboard adds the common English variants itself
   (`plan show` lists them as "also searched"), so spend the slots on the local words.
   - roles `cv` (jobs in my field): the job titles from `suggested_roles` and the CV, as employers write them in ads
     (e.g. "Softwareentwickler C++", "C++ Developer"; "Cameriere di sala", "Cameriere").
   - roles `any` (any job of this type): broad words for the job type in the local language, not tied to the
     user's field: e.g. Germany mini-job → "Minijob", "Aushilfe", "Teilzeit";
     Italy part-time → "part time", "stagionale", "weekend", "addetto"; UK → "part time", "weekend", "temporary".
     Add the 3–5 most common entry-level jobs nearby (shops, bars, hotels, warehouses, cleaning, delivery…),
     but leave out what the user wants to avoid.
   - roles `custom`: the user's titles, translated and with common variants.
   Also fill `title_keywords`: single words a matching job title contains (used to filter results; include every role
   word of the search words, e.g. "developer", "engineer", "entwickler", "c++"), and
   `exclude_keywords`: words that mean the job is wrong (e.g. "senior", "Ausbildung" if not wanted). For `any`
   targets leave `title_keywords` empty.
5. **Places and towns.** The places to search are the target's own places, else the profile's "Search in" places
   (`hunt profile` → `Search in:`), else the user's city. Several places are normal (e.g. "Berlin, Leipzig, Sachsen,
   Niedersachsen"). Add an entry to `places` for each one:
   - a **city**: `{ "name": "Leipzig", "kind": "city" }`, and its towns within the radius (`location.radius_km`, or
     the target's own radius) to `towns`;
   - a **region** (a German Land, an Austrian Bundesland, an Italian regione, a Spanish comunidad, a French région, a
     province…): `{ "name": "Sachsen", "kind": "region", "aliases": ["Saxony"], "centers": ["Leipzig", "Dresden", "Chemnitz"] }`.
     `aliases`: its other names, **the English name first** (LinkedIn searches the region by it). `centers`: its 2–4
     biggest cities, spread over the region (boards that cannot search a whole region search 50 km around each).
     Add its main cities and towns (up to 40 per region) to `towns`.
   Write `towns` the way they are written in ads, at most 300 in all. If remote work is allowed, add "Remote".
6. **Companies** (optional): if the user named employers they want, or the field has well-known local employers,
   list up to 20 as `{"name": "…"}`; Huntboard checks their career pages itself.
7. Write the plan to `<workspace>/tmp/plan_<target>.json` and save it:
   `node tools/hunt.js plan set <workspace>/tmp/plan_<target>.json --target <id>`
   ```json
   { "country": "IT", "queries": ["…"], "title_keywords": ["…"], "exclude_keywords": [], "towns": ["…"],
     "places": [{ "name": "Rimini", "kind": "city" }, { "name": "Emilia-Romagna", "kind": "region", "aliases": ["Emilia-Romagna"], "centers": ["Bologna", "Parma", "Ravenna"] }],
     "languages": ["Italian", "English"], "max_age_days": 14,
     "boards": [{ "id": "indeed", "why": "most ads in Italy" }, { "id": "subito_lavoro", "why": "local part-time jobs" }],
     "companies": [], "notes": "…" }
   ```
8. Reply with a short summary per target: the boards and why, the search words, and anything the user can do to get
   more results (e.g. a free key for a board).
