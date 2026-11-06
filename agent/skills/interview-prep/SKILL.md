---
name: interview-prep
description: Prepares the user for the next interview round of one job, tailored to the interview step (recruiter call, HR screen, technical, assignment, trial shift, panel, final, offer), the job ad, the documents that were sent and earlier rounds. Use when a job is moved to Interview, when the user says "prepare me for the interview at …", or from the Prepare button.
---

# Prepare the interview

Follow `AGENTS.md`. Never invent facts about the user or the company; mark guesses as guesses and list sources.

1. **Read everything** about the job: `node tools/hunt.js show <KEY> --posting`. The last interview round tells you
   the stage, date, format, interviewers, language and the invitation text. Read the earlier rounds' debriefs
   (files in the ticket's `interview/` folder) and the documents that were actually sent (`docs/sent-*`, else `docs/`).
2. **Read the user**: `node tools/hunt.js cv show`, `profile`, relevant documents (`docs text <id>`), notes on the
   ticket, and the story bank `<workspace>/profile/story_bank.md` (create it if missing: reusable STAR stories from
   the CV, each with the CV line it proves).
3. **Research the company** with web search: website, what they sell / do, size, locations, recent news, the
   interviewers' public professional profiles if names are given, reviews of their interviews. Note the sources.
4. **Choose the files** from `agent/skills/interview-prep/stages.md` for this stage and the time left. If key facts
   are missing (salary floor, notice period, reason for leaving, start date), ask the user at most 3 questions with
   `hunt ask`; otherwise leave clear ⚠️ fill-ins.
5. **Write the pack** into `<ticket folder>/interview/<NN>-<stage>/` (NN = round number, e.g. `interview/02-technical/`),
   in the user's reply language (interview phrases in the interview language). Practical, no filler: every answer is
   something the user can say out loud in 60–90 seconds.
6. **Register it**: `node tools/hunt.js round <KEY> <n> prep_dir=interview/<NN>-<stage>`. Optionally make PDFs of the
   day sheet: `node tools/hunt.js pdf-md <file>`.
7. **Update the story bank** with any new story you wrote.
8. Reply: when the interview is, the 3 things that matter most, the files made, and the fill-ins the user must do.
