# Adding a job board

Boards live in `boards/registry.json`. Check your change with `node tools/hunt.js boards validate`.

```json
{ "id": "my_board", "name": "My Board", "url": "https://…", "countries": ["IT"], "sectors": ["hospitality"],
  "job_types": ["part_time", "seasonal"], "access": { "kind": "browser", "playbook": "generic" },
  "needs_login": false, "apply": "native", "priority": 6, "verified": false, "notes": "…" }
```

| Field | Values |
|---|---|
| `countries` | ISO codes (`IT`, `DE`…), `EU` (all EU/EEA countries) or `*` (worldwide) |
| `sectors` | `*`, `tech`, `hospitality`, `retail`, `logistics`, `healthcare`, `trades`, `office`, `education`, `public`, `students`, `hourly`, `remote`, `startups`, `finance`, `engineering`, `creative`, `household` |
| `job_types` | `*` or `full_time`, `part_time`, `temporary`, `contract`, `internship`, `apprenticeship`, `seasonal`, `mini_job`, `freelance` |
| `access.kind` | `api` (a collector in `lib/collectors.js`), `browser` (the AI follows a playbook), `manual` |
| `access.key_env` | environment variables an API key needs (read from `.env`) |
| `apply` | `native` (apply on the board), `easy` (one-click with a login), `external` (the board links to the employer) |
| `priority` | 0–10: how much this board matters in its countries |
| `remote_only` | `true` for remote-job boards |
| `verified` | `true` only after a real search worked |

**Browser boards** need a playbook in `boards/playbooks/<name>.md`: the search URL, a `browser_evaluate` snippet that
reads the result cards, how to read one ad, and the JSON to save for `hunt ingest`. `generic.md` works for most
boards; write a specific one when a board needs special handling.

**Boards that send their results as plain HTML** need no code: use the `html` collector, so Huntboard reads them
itself and the AI does not spend tokens paging through them. Check first that a plain request returns the result
cards (no robot check, no login), then set
`"access": { "kind": "api", "collector": "html", "playbook": "generic", "search_url": "…", "job_link": "…" }`:
`search_url` is the result page with `{q}` (search word, URL-encoded) or `{q_slug}` (`c-entwickler`), `{where}` /
`{where_slug}`, `{radius}` (km), `{radius_mi}`, `{days}`; `job_link` is a regular expression matching an ad's URL
(e.g. `/jobs/[a-z0-9-]+/\\d{6,}`). The ad pages are read with their schema.org JobPosting data. Keep the playbook: when
the board refuses the request or shows a robot check, the AI searches it with the browser instead.

**API boards** need a collector in `lib/collectors.js` (`run(ctx) → { rows, coverage }`) with a pure `parse…`
function, and a test with a recorded answer in `test/search.test.js`. Never send the user's personal data to a job
board: only search words, place and filters.

**Company career boards** (the `ats` collector) are not registry entries: they are `plan.companies` entries with
`ats` and `slug`. The endpoints are `ATS` in `lib/collectors.js` (`greenhouse`, `lever`, `lever_eu`, `ashby`,
`smartrecruiters`, `personio`, `recruitee`), and `URL_PATTERNS` turns a board URL into `{ ats, slug }`. EU hosts:
`job-boards.eu.greenhouse.io` is served by the normal Greenhouse API, `jobs.eu.lever.co` only by `api.eu.lever.co`
(`lever_eu`). A new kind needs an `ATS` endpoint, a `parseAts` case, a URL pattern and a test in
`test/discover.test.js`; `hunt discover add <url>` then adds such boards.

Users can also add boards for themselves (the AI does it during `plan-search`): they go to
`workspace/boards.custom.json` and are never committed.
