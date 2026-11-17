---
name: implement
description: "Implement an assigned task, spec or ticket after the target project's start rule is satisfied. Use for implementation requests; the harness decides whether ordinary assignment or a named entrypoint is required."
---

Implement the assigned work. First read target root `AGENTS.md`, applicable instructions and its implementation pointers. Satisfy its start rule before writing: a request, readiness label or this skill's discovery does not override that rule.

If the user passes a ticket reference, fetch it from the configured issue tracker and state its title. If the reference is ambiguous, ask.

Prepare or reuse the execution context under project instructions. Record starting HEAD and an immutable review base covering the complete assigned change, including earlier commits when resuming.

Use `tdd` where the project's testing rules require it, at its accepted seams. Invoke skills through the current client's mechanism; when unavailable, read the named skill's `SKILL.md` and relevant references and follow them. Run targeted checks during the loop and the project's applicable verification level at the end.

Follow the project's review/commit order. For commit-first review, commit the assigned changes and pass immutable base/head to `code-review`. For required pre-commit review, freeze scoped content as an immutable Git tree using the project helper or a temporary index; preserve the real index and branch. Pass that snapshot and base to `code-review`, then verify the delivered commit tree matches the frozen final content, recording any review corrections separately. Include the requirement source.

Run `code-review` once, then make one fix pass for blocking defects within the assignment. Optional suggestions may be left with a one-line reason. Rerun affected checks and freeze the corrected content under that same project order; retain the review report and correction evidence for delivery.

After corrections, follow [independent verification](VERIFICATION.md) when the target requires it; retain observed outcomes and limits separately from test/review results.

Follow root `AGENTS.md` delivery pointers for the verified result.
