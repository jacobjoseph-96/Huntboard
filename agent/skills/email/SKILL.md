---
name: email
description: Writes the application e-mail for one job on the board, in the job's language, short and in the user's own voice, from their real experience, as an e-mail draft with the CV and letter attached and as text to copy. Use when the user says "write the e-mail for JOB-12", presses Write an e-mail, or when a job is applied to by e-mail.
---

# Write the application e-mail

Follow `AGENTS.md`: only facts from the CV, documents, profile, ticket notes and the ad. Huntboard never sends
e-mail: you make a draft, the user checks it and presses Send.

1. Read the job: `node tools/hunt.js show <KEY> --posting` (follow its `INSTRUCTIONS FROM THE USER`, if any). Find in
   the ad: the e-mail address for applications, the contact person, the reference number, the language, and what the
   ad asks applicants to send.
2. Read the user: `node tools/hunt.js cv show`, `node tools/hunt.js profile`. Note which documents the ticket already
   has (`files` in `show`): CV, cover letter, attachments. If there is no CV for this job yet, say so in your reply
   (the user can press "Tailor my CV" or "Use my CV as it is"); do not make one here unless your task asks for it.
3. Read `agent/skills/cover-letter/style.md`, sections "The same, in an e-mail" and "Sound like the user".
4. Write the e-mail in the ad's language to `<workspace>/tmp/<KEY>_email.txt` (only the body, no "Subject:" line):
   - the greeting of the country, with the contact's name if the ad gives one;
   - 3–5 short sentences: the exact job (and reference number) and the one concrete reason this job fits; one proof
     from the user's CV told as real work; what is attached; a confident close;
   - the closing of the country and the user's name, phone and e-mail from the profile.

   **Truth rules:** no skill, tool, number or experience that is not in the user's data, however much the ad wants
   it; no invented reason to apply. If the letter exists, the e-mail does not repeat it: it is the short version.
5. Check it: `node tools/hunt.js factcheck <workspace>/tmp/<KEY>_email.txt --ticket <KEY>`. Fix every fact it lists
   and rewrite the lines its style hints name.
6. Make the draft: `node tools/hunt.js email draft --ticket <KEY> --to <address from the ad> --subject "<the job
   title, the reference number if any, the user's name>" --body-file <workspace>/tmp/<KEY>_email.txt`. Without an
   address in the ad leave out `--to` (the user fills it in). It attaches the ticket's CV, letter and attachments PDF
   and also saves the text as `docs/Application_email.txt`, to copy into a web form.
7. Tell the user in two or three lines: where the draft is (Documents tab: open `Application_email.eml`, check it,
   press Send), which files are attached, and to change any word that does not sound like them. When the user has
   sent it, the ticket goes to "Applied" (`node tools/hunt.js sent <KEY> --channel "E-mail"` and
   `node tools/hunt.js move <KEY> applied`, once the user says it is sent).
