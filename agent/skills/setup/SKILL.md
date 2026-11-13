---
name: setup
description: Reads the user's CV and documents and fills in their Huntboard profile (contact, languages, education, certificates, suggested job titles) and the structured CV. Use when the user says "set up my profile", "read my CV", "fill my profile" or after they upload a new CV.
---

# Set up the profile from the CV and documents

Follow `AGENTS.md` (never invent facts; change data only with `node tools/hunt.js`).

1. Run `node tools/hunt.js docs list`. If there is no document of type `cv`, run
   `node tools/hunt.js ask "Please upload your CV on the Profile page first." --choices "OK"` and stop.
2. Read the CV text with `node tools/hunt.js docs text <id>`. Also read every other document whose text is
   available (degrees, certificates, references, language certificates). If a document has no text
   (`text: image` or `needs_review`) and you can read images or PDFs yourself, open the file directly; otherwise skip it
   and mention it in your summary.
3. Read the current profile with `node tools/hunt.js profile --json`. Things the user already filled in are
   right: never change them.
4. Write the structured CV to `<workspace>/tmp/cv.json` (the workspace folder named in your task; normally `workspace`) and save it with `node tools/hunt.js cv set <workspace>/tmp/cv.json`.
   Format (leave out what is not there, never guess):
   ```json
   {
     "name": "", "headline": "", "summary": "",
     "contact": { "email": "", "phone": "", "address": "", "city": "", "country": "", "links": [], "extra": [] },
     "experience": [{ "title": "", "company": "", "location": "", "start": "YYYY-MM", "end": "YYYY-MM or present", "bullets": [], "tech": "" }],
     "education": [{ "degree": "", "school": "", "location": "", "start": "", "end": "", "grade": "", "recognition": "", "note": "", "document_id": "" }],
     "certificates": [{ "name": "", "issuer": "", "date": "", "document_id": "" }],
     "languages": [{ "name": "", "level": "" }],
     "skills": [{ "group": "", "items": [] }],
     "references": [{ "from": "", "role": "", "company": "", "quote": "", "document_id": "" }],
     "other": []
   }
   ```
   `document_id` links an entry to the uploaded document that proves it. `quote` is a short, exact sentence from a
   reference letter.
   - `languages`: every entry needs `name` and `level`, each exactly as the CV states it ("English", "C1"). The CV
     prints them as "English: C1".
   - `contact.extra`: short lines the CV has next to the contact details ("Available immediately", "Open to relocation").
   - `tech`: the tools or technologies line of a job, if the CV has one.
   - `recognition`: an official recognition of that degree (ZAB Zeugnisbewertung, anabin, ENIC-NARIC...). It belongs
     to the degree and prints under it; it is not a certificate. `note`: one more line under the degree (main subjects).
   - List jobs and education in any order: every CV prints them newest first.
5. Write `<workspace>/tmp/profile_patch.json` and apply it with
   `node tools/hunt.js profile patch <workspace>/tmp/profile_patch.json --only-empty`:
   - `person`: name, email, phone, address, city, country, links: only what the CV states.
   - `location`: city and country where the user lives now (from the CV), if stated.
   - `about.languages`: `[{ "name": "Italian", "level": "B1" }]` with the levels stated in the CV or certificates.
   - `about.driving_licence`: only if the CV mentions one.
   - `suggested_roles`: 4–10 job titles this person can realistically apply for, based on their experience and
     education. Write each title in English and, if the user lives in a non-English-speaking country, also in that
     country's language, e.g. `"Waiter / Cameriere"`.
6. If the work permit situation, a language level, or the city where they live is unknown, ask at most three short
   questions with `node tools/hunt.js ask "..."` and put the answers into the profile with
   `node tools/hunt.js profile set <path>=<value>` (for example `about.work_permit="EU citizen"`).
7. Reply with a short summary: what you filled in, the suggested job titles, the documents you could not read, and
   that the user should check the Profile page.
