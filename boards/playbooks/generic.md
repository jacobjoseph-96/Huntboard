# Playbook: any job board (browser)

Use this for every board without its own playbook. You use the browser tools (`browser_navigate`,
`browser_snapshot`, `browser_evaluate`, `browser_click`, `browser_type`).

1. Open the board's URL from `node tools/hunt.js boards list` (or the search plan).
2. Accept or reject the cookie banner (prefer "reject" / "only necessary"). Never log in unless the user already is.
3. Use the board's own search form: type one search word from the plan into the "what" field and the city into the
   "where" field; set the distance (radius) and "posted in the last N days" filters if the board has them.
4. On the result list, read the cards with `browser_evaluate` instead of screenshots. Start from this and adapt the
   selectors to what `browser_snapshot` shows:
   ```js
   () => [...document.querySelectorAll('article, li, [data-testid*="job"], [class*="job-card"], [class*="JobCard"]')]
     .map(c => ({ title: c.querySelector('h2, h3, [class*="title"]')?.innerText.trim(),
                  company: c.querySelector('[class*="company"], [data-testid*="company"]')?.innerText.trim(),
                  location: c.querySelector('[class*="location"], [data-testid*="location"]')?.innerText.trim(),
                  url: c.querySelector('a[href]')?.href,
                  card: c.innerText.slice(0, 400) }))
     .filter(j => j.title && j.url)
   ```
5. Look at the first 2 result pages per search word. Open the ads that look relevant and copy the full ad text
   (`document.querySelector('main')?.innerText` or the ad's container) into `body`.
6. Save everything as one JSON array in the workspace tmp folder:
   `[{ "title", "company", "location", "url", "posted": "YYYY-MM-DD", "body", "salary", "job_type" }]`
   and run `node tools/hunt.js ingest <file> --target <t> --source <board id>`.

**Robot checks** ("verify you are human", captchas, Cloudflare): never try to solve or get around them. Ask the user
with `node tools/hunt.js ask "Please solve the check in the browser window, then press Done" --choices "Done,Skip this board"`
(in fully automatic mode: skip the board and write it down with `hunt decide`).
