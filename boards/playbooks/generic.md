# Playbook: any job board (browser)

Use this for every board without its own playbook. You use the browser tools (`browser_navigate`,
`browser_snapshot`, `browser_evaluate`, `browser_click`, `browser_type`).

1. Open the board's URL from `node tools/hunt.js boards list` (or the search plan).
2. Accept or reject the cookie banner (prefer "reject" / "only necessary"). Never log in unless the user already is.
3. Use the board's own search form: type one search word from the plan into the "what" field and one place of the
   plan (`places`) into the "where" field; set the distance (radius, for a city only) and "posted in the last N days"
   filters if the board has them. Repeat for each place of the plan.
4. On the result list, read the cards with this `browser_evaluate` first: it returns short JSON and costs far fewer
   tokens than `browser_snapshot` or screenshots. Take one snapshot only if it returns nothing, and adapt the selectors.
   ```js
   () => [...new Map([...document.querySelectorAll('article, li, [data-testid*="job"], [class*="job-card"], [class*="JobCard"], [class*="result"]')]
     .map(c => ({ title: c.querySelector('h2, h3, [class*="title"]')?.innerText.trim().slice(0, 150),
                  company: c.querySelector('[class*="company"], [data-testid*="company"]')?.innerText.trim().slice(0, 80),
                  location: c.querySelector('[class*="location"], [data-testid*="location"]')?.innerText.trim().slice(0, 80),
                  url: c.querySelector('a[href]')?.href }))
     .filter(j => j.title && j.url && !/[?&](q|query|keywords?)=/.test(j.url)).map(j => [j.url, j])).values()]
   ```
5. Look at the result pages the search report says (1 page per search word when it saves AI usage, else 2).
   **Do not copy the ad texts**: `ingest` reads each ad from its link itself. Copy an ad's text into `body` only when
   `ingest` reports it as unread (the board blocks plain requests).
6. Save everything as one JSON array in the workspace tmp folder:
   `[{ "title", "company", "location", "url", "posted": "YYYY-MM-DD", "salary", "job_type" }]`
   (`url` = the card's full link, as the snippet returns it) and run
   `node tools/hunt.js ingest <file> --target <t> --source <board id>`.

**Robot checks** ("verify you are human", captchas, Cloudflare): never try to solve or get around them. Ask the user
with `node tools/hunt.js ask "Please solve the check in the browser window, then press Done" --choices "Done,Skip this board"`
(in fully automatic mode: skip the board and write it down with `hunt decide`).
