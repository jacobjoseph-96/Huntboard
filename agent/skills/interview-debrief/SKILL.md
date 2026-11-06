---
name: interview-debrief
description: After an interview, records the questions that were asked, writes better answers, drafts the thank-you message and prepares the next round. Use when the user says "debrief", "the interview at … is done", "they asked me …", or from the Debrief button.
---

# Debrief an interview

Follow `AGENTS.md`.

1. Read the ticket (`node tools/hunt.js show <KEY>`) and the prep pack of the last round.
2. Ask the user (with `hunt ask`, one question at a time, free text) unless your task already contains it:
   - "Which questions were you asked? Write them in any order, as you remember them."
   - "How did it go, and what did they say about next steps?"
   - "Anything you would like to correct or add to an answer you gave?"
3. Write `<ticket folder>/interview/<NN>-<stage>/DEBRIEF.md`:
   - the questions as asked (raw), then each with a better answer (a "say" line plus details), linked to the CV line
     or story it should use;
   - what this tells about the next round (topics, the interviewer's focus);
   - lessons for every future interview.
4. Draft a short thank-you message in the interview language (3–5 sentences, same day), with an optional correction
   paragraph if the user wants to fix an answer. Put it into the debrief file. If the user wants an e-mail file and
   the contact address is known: `node tools/hunt.js email draft …` (attachments are not needed).
5. Update `<workspace>/profile/story_bank.md`: add the questions to a "Questions that come up" table (question,
   company, date) and any new stories.
6. Save the summary on the round: `node tools/hunt.js round <KEY> <n> debrief="<3-line summary>" outcome="<waiting|next round|offer|rejected>"`.
   If the user already knows the next step, add it (`hunt interview <KEY> --stage <next stage> --at <date>`) or move
   the ticket (`hunt move <KEY> offer|closed --resolution rejected`).
7. Reply with the thank-you draft and the 3 things to practise for the next round.
