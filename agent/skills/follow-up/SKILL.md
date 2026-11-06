---
name: follow-up
description: Writes a short, polite follow-up for an application with no answer, in the job's language, as an e-mail draft or a message to copy. Use when the inbox says an application has had no answer for a while, or the user says "follow up on JOB-12".
---

# Follow up on an application

Follow `AGENTS.md`.

1. Read the ticket (`node tools/hunt.js show <KEY>`): when and how the user applied, the contact person and address
   (from the ad, the e-mail draft or the notes), earlier follow-ups in the history.
2. If there were already two follow-ups, do not write another: suggest closing the ticket
   (`hunt move <KEY> closed --resolution expired`) and say so.
3. Write 3–5 sentences in the ad's language: the job and the date applied, that the user is still interested (one
   concrete reason), a polite question about the status and timeline, thanks. No pressure, no new claims.
4. If an e-mail address is known: write the text to `<workspace>/tmp/<KEY>_followup.txt` and run
   `node tools/hunt.js email draft --ticket <KEY> --to <address> --subject "<subject>" --body-file <file>`;
   otherwise put the text in your reply for the user to send through the board or portal.
5. Record it: `node tools/hunt.js followed-up <KEY> "<how: e-mail draft / portal message>"` (this resets the reminder).
6. Reply with the text and where to send it.
