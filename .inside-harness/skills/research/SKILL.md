---
name: research
description: Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.
---

Spin up a **background agent** to do the research, so you keep working while it reads. Use the
tracked task's single writing worktree for the durable report. Additional research agents gather
evidence read-only and return it to that writer; they do not create a worktree per source or
subquestion.

Its job:

1. Investigate the question against **primary sources** (official docs, source code, specs, first-party APIs), not a secondary write-up of them. Follow every claim back to the source that owns it.
2. Write the findings to a single Markdown file, citing each claim's source.
3. Save it where the repo already keeps such notes; match the existing convention, and if there is none, put it somewhere sensible and say where.
4. Return the decision handoff required by the repository `WORKFLOW.md` to the invoking session.
   For research, state the recommended conclusion, the decision it enables, and unresolved proof
   gates. The invoking session synthesizes the handoff in its final user-facing chat response.
