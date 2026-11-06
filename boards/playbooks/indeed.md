# Playbook: Indeed (browser)

Plain web requests are blocked by Indeed, so use the browser tools. Read data with `browser_evaluate`, not screenshots.

**Country site:** `it.indeed.com`, `de.indeed.com`, `fr.indeed.com`, `es.indeed.com`, `nl.indeed.com`, `at.indeed.com`,
`ch.indeed.com`, `pl.indeed.com`, `in.indeed.com`, `ca.indeed.com`, `au.indeed.com`, `uk.indeed.com` (United Kingdom),
`www.indeed.com` (United States).

**Search** (one per search word; next page: add `&start=10`, `&start=20`…):
`https://<site>/jobs?q=<search word>&l=<city>&radius=<km>&fromage=<days: 1, 3, 7 or 14>`
- part-time only: add `&sc=0kf%3Ajt(parttime)%3B` · remote: add `&remotejob=032b3046-06a3-4876-8dfd-474eb5e7ed11`
  (if a filter does not work on a country site, leave it out and filter the cards yourself).

**Read the result cards:**
```js
() => [...document.querySelectorAll('.job_seen_beacon')].map(c => ({
  title: c.querySelector('h2.jobTitle, h3.jobTitle')?.innerText.trim(),
  jk: c.querySelector('a[data-jk]')?.dataset.jk,
  company: c.querySelector('[data-testid="company-name"]')?.innerText.trim(),
  location: c.querySelector('[data-testid="text-location"]')?.innerText.trim(),
  card: c.innerText.slice(0, 500)
})).filter(j => j.jk)
```

**Read one ad:** `https://<site>/viewjob?jk=<jk>`; the text is in `#jobDescriptionText`, salary and job type in
`#salaryInfoAndJobType`:
```js
() => ({ body: document.querySelector('#jobDescriptionText')?.innerText.trim(),
         salary: document.querySelector('#salaryInfoAndJobType')?.innerText.trim() })
```

**Save** as a JSON array with `"url": "https://<site>/viewjob?jk=<jk>"`, `"native_id": "<jk>"`, title, company,
location, posted (turn "3 days ago" into a date), body, salary, job_type. Then
`node tools/hunt.js ingest <file> --target <t> --source indeed`.

Indeed sometimes shows "Verify you are human". Never try to get around it: ask the user to solve it in the browser
window with `hunt ask` (fully automatic mode: skip Indeed for this run and record it with `hunt decide`).
