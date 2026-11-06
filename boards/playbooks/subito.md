# Playbook: Subito.it Lavoro (Italy) (browser)

Good for part-time, seasonal and local jobs (bars, hotels, shops, cleaning, warehouses).

1. Open `https://www.subito.it/annunci-<regione>/vendita/offerte-lavoro/?q=<search word>`, where `<regione>` is the
   region in lowercase without spaces (e.g. `emilia-romagna`, `lazio`, `lombardia`). Use the city filter if offered.
2. Read the list:
   ```js
   () => [...document.querySelectorAll('[class*="item-card"], [class*="SmallCard"], article')].map(c => ({
     title: c.querySelector('h2, h3, [class*="title"]')?.innerText.trim(),
     location: c.querySelector('[class*="town"], [class*="city"], [class*="location"]')?.innerText.trim(),
     posted: c.querySelector('[class*="date"], time')?.innerText.trim(),
     url: c.querySelector('a[href]')?.href,
     card: c.innerText.slice(0, 400)
   })).filter(j => j.title && j.url)
   ```
3. Open each relevant ad and copy the description into `body`. Subito ads are often short and private: the company may
   be missing; use "Azienda riservata".
4. Skip ads that ask for money, sell courses, or are MLM / "network marketing".
5. Save as a JSON array and run `node tools/hunt.js ingest <file> --target <t> --source subito_lavoro`.
