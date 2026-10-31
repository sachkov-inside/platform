---
name: ship
description: "Deliver reviewed, committed work: open or update the PR, get CI green, decide whether the owner must check the result, then merge or hand it over. Use after implement or implement-spec, or when the user asks to ship a branch."
---

Deliver the current branch. `code-review` is done and its confirmed findings are fixed and committed.

Read `docs/agents/ship.md` from the target branch, if it exists, not from this branch. It can list sensitive zones, merge permission, and extra required checks.

## Steps

1. Push the branch. Call the Skill tool with "pr" to write the body, then open the PR or update the existing one. Link the ticket with the tracker's closing keyword. Without PRs, the project's local checks replace CI; do steps 3–4 before pushing to `main`.

2. Wait for required CI. Fix real failures and push again. If a failure is unrelated to the diff, re-run it once and name it in the PR.

3. Decide whether the owner must check the result. Answer three questions:

   - **Door:** can one revert undo the change, with nothing lost, and will no later work be built on it? Data migrations, sent messages, releases, public contracts, and new architecture are one-way doors.
   - **Zone:** does the diff stay outside the sensitive zones? The zones are those in `docs/agents/ship.md`, plus always: money, auth and permissions, production data, personal data, secrets, legal text, CI and release workflows, and agent instructions (`AGENTS.md`, `WORKFLOW.md`, skills, `docs/agents/`).
   - **Proof:** does the Evidence cover every acceptance criterion without human judgement? A "no" also covers an open review finding, a product choice you made outside the agreed result, and new visual design or UX.

   Three "yes" answers: no owner check. Any "no": name what the owner must look at or decide. Put it in the PR body and in your reply. If the owner already accepted that exact thing, in the assignment or earlier in the conversation, the answer is "yes".

   An owner check means looking at the result or making the decision. It is not a code review, unless `docs/agents/ship.md` asks for one.

4. Merge only when step 3 needs no owner check and merge permission is written in the project's instructions or the owner's words. Otherwise mark the PR ready for review and stop. Without PRs, keep the commits unpushed and stop.

5. Report the PR, the CI state, the three answers, and what the owner must do, if anything.
