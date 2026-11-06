# Privacy

- **Everything stays on your computer** in the `workspace/` folder: your profile, CV and documents, tickets, the
  AI's work and the browser logins. The folder is in `.gitignore`, so it never ends up in git.
- **Your AI tool** (the one you chose in Settings) receives what it needs for a task: your profile, CV, documents and
  job ads. Its provider's privacy terms apply (with a local model through OpenCode, nothing leaves your computer).
- **Job boards** only receive search words, a place and filters, never your personal data.
- **Employers** receive your documents and form answers only when you apply, and only as far as your applying mode
  allows.
- **The app** listens only on `127.0.0.1` (your own computer), checks that requests come from its own page, and
  every request needs a secret token stored in `workspace/settings.json`.
- **Documents marked sensitive** (ID, work permit, driving licence) are never attached to applications unless you say
  so.
- **Deleting**: delete a document on the Profile page (it is moved to `workspace/documents/.removed`), or delete the
  `workspace/` folder to remove everything.
