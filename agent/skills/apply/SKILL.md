---
name: apply
description: Applies to the jobs in "To apply" as far as the user's applying mode allows (prepare only, fill forms, apply after one OK, or fully automatic) - tailored CV, cover letter, attachments, the application form or e-mail, and a record of what was sent. Use when the user says "apply", "apply to JOB-12", presses Apply, or after a search in fully automatic mode.
---

# Apply

Follow `AGENTS.md`. Read the mode first: `node tools/hunt.js profile` → `Applying: <mode>`.

| Mode | What you may do |
|---|---|
| `off` | Prepare documents, links and e-mail drafts. Never open or fill an application form. |
| `assist` | Prepare, open the form, fill it in and check it. **Stop before Submit** and ask the user to look and press it. |
| `auto` | Like assist, but you press Submit yourself after the user confirmed the list once for this run. |
| `full_auto` | You act for the user (see the task's "Fully automatic mode" section): no confirmation, decide yourself, record decisions with `hunt decide`, park what needs the user with `hunt needs`. |

**Never, in any mode:** type a password, solve or get around a robot check, create an account without asking, fill
hidden fields, invent an answer, accept "update my profile" offers, submit twice, or apply to more jobs today than
`applying.daily_cap` (count today's tickets in "Applied").

## 1. The list
- Jobs: the tickets named in your task, else `node tools/hunt.js list --status to_apply`. In `full_auto` only those
  with a fit score ≥ `applying.min_fit`.
- For each one, check: is there a ticket for the same company that is "Applied" in the last 30 days, or "Closed /
  rejected" in the last 6 months (`hunt list`)? Then skip it and say why. Is the ad still online (open the link)?
  If it is gone: `hunt move <KEY> closed --resolution expired`.
- `auto`: show the list once: `node tools/hunt.js ask "Apply to these N jobs? KEY – job – company …" --choices "Yes, apply,No"`.
  Continue only on yes.

**Instructions from the user** (`INSTRUCTIONS FROM THE USER` in `hunt show`, also listed in your task): do what they
say for that job, also where this file says otherwise (e.g. "it is fine to delete the stored CV and attach the new one").
A ticket that was "Needs you" and now has instructions answering it is yours again.

## 2. Documents (for each job)
1. Tailored CV: follow the `tailor` skill (skip if `docs/` already has a CV made for this job).
2. Cover letter: follow the `cover-letter` skill when the job or the country expects one, or the form has a field.
3. Attachments: `node tools/hunt.js attachments build --ticket <KEY>` (it follows the user's setting and the
   country's custom; never adds documents marked sensitive).

## 3. The route
Open the ad (`show <KEY>` → link) with the browser tools and find how to apply:
- **Company site or applicant system** (Workday, Greenhouse, Lever, Personio, SmartRecruiters…) → channel "Company site".
- **The board's own form** (Easy Apply on LinkedIn, Indeed Apply, StepStone…) → channel "Easy Apply". These need the
  user to be logged in in the Huntboard browser window; if not, `hunt ask` them to log in (fully automatic: `hunt needs`).
- **E-mail only** → `node tools/hunt.js email draft --ticket <KEY> --to <address> --subject "…" --body-file <file>`
  with a short e-mail in the ad's language (3–5 sentences; the letter and CV are attached), written by the rules
  in `agent/skills/cover-letter/style.md` ("The same, in an e-mail"). Huntboard never sends
  e-mail: the user opens the draft and presses Send. Mark it with `hunt needs <KEY> "Send the e-mail draft in Documents"`.
- `off` mode: stop here for every job: note the link and the route on the ticket (`hunt note`) and move on.

## 4. The form (`assist`, `auto`, `full_auto`)
1. List the visible fields with `browser_evaluate` (label, name, type, required, options). Ignore hidden fields.
2. Fill them from the profile (`person`, `applying.answers`), the tailored documents and the ticket. Upload the PDFs
   from the ticket's `docs/` folder with `browser_file_upload`.
3. A required question you cannot answer from the user's data: `assist`/`auto` → `hunt ask` the user;
   `full_auto` → if the answer clearly follows from their data decide and `hunt decide`, else `hunt needs` and skip.
4. Read every field back and compare with what you meant to enter. Fix differences.
5. **Submit:**
   - `assist`: `node tools/hunt.js ask "The form for <job> at <company> is filled in. Please check it in the browser window and press Submit yourself." --choices "I submitted it,I did not submit it"`.
   - `auto` / `full_auto`: find the submit button; press it only if exactly one button matches, and only once.
6. Confirmation: wait for the confirmation page or message. Take a screenshot into the ticket folder
   (`browser_take_screenshot` with filename `<ticket folder>/docs/confirmation.png`). No confirmation → do not retry;
   `hunt needs <KEY> "Check whether the application went through"`.

## 5. Record it
For every job that was really sent (by you or the user):
```
node tools/hunt.js sent <KEY> --channel "Company site|Easy Apply|E-mail" --confirmation "<what the page said>"
node tools/hunt.js move <KEY> applied --note "Applied via <channel>"
```
In `off` mode nothing is sent, so nothing is moved.

## 6. Reply
A short list: applied (KEY – company), prepared only, waiting for the user (and what to do), skipped and why.
