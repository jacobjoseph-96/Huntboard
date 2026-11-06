# Playbook: InfoJobs (Italy: infojobs.it, Spain: infojobs.net) (browser)

1. Open `https://www.infojobs.it/offerte-lavoro?keyword=<search word>` (Spain: `https://www.infojobs.net/jobsearch/search-results/list.xhtml?keyword=<search word>`).
   If the URL does not filter, use the search form: keyword + province / city. Reject optional cookies.
2. Read the result list (adapt the selectors to `browser_snapshot` if needed):
   ```js
   () => [...document.querySelectorAll('article, li[class*="offer"], div[class*="offer"]')].map(c => ({
     title: c.querySelector('h2, h3, a[class*="title"]')?.innerText.trim(),
     company: c.querySelector('[class*="company"], [class*="empresa"], [class*="azienda"]')?.innerText.trim(),
     location: c.querySelector('[class*="location"], [class*="city"], [class*="provincia"]')?.innerText.trim(),
     url: c.querySelector('a[href*="offert"], a[href*="of-"], a[href]')?.href,
     card: c.innerText.slice(0, 400)
   })).filter(j => j.title && j.url)
   ```
3. Open each relevant ad and copy the description (the main text block) into `body`.
4. Save as a JSON array and run `node tools/hunt.js ingest <file> --target <t> --source infojobs_it` (or `infojobs_es`).
