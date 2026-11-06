# Playbook: LinkedIn (browser fallback)

`node tools/hunt.js search run` reads LinkedIn's public job search by itself. Use this playbook only when the search
report says LinkedIn is limiting requests.

**Search list** (an HTML fragment with 10 jobs; next page `&start=10`, `&start=20`…), no login needed:
`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=<search word>&location=<city>%2C%20<country>&distance=<miles: km × 0.62>&f_TPR=r<days × 86400>&start=0`
- job types: add `&f_JT=F` (full-time), `P` (part-time), `C` (contract), `T` (temporary), `I` (internship), e.g. `&f_JT=P%2CT`.
- remote only: `&f_WT=2`.

```js
() => [...document.querySelectorAll('li')].map(li => ({
  id: (li.querySelector('[data-entity-urn]')?.dataset.entityUrn || '').split(':').pop(),
  title: li.querySelector('.base-search-card__title')?.innerText.trim(),
  company: li.querySelector('.base-search-card__subtitle')?.innerText.trim(),
  location: li.querySelector('.job-search-card__location')?.innerText.trim(),
  posted: li.querySelector('time')?.getAttribute('datetime')
})).filter(j => j.id)
```

**One ad:** `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>`; the text is in
`.show-more-less-html__markup`, the job type in `.description__job-criteria-list`.

Save with `"url": "https://www.linkedin.com/jobs/view/<id>"`, `"native_id": "<id>"` and run
`node tools/hunt.js ingest <file> --target <t> --source linkedin`.
