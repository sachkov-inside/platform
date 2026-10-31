---
name: implement
description: "Implement a piece of work based on a spec, a set of tickets, or a result agreed in conversation. Use when the user asks to build or implement it, not while they are still discussing it."
---

Implement the work described by the user in the spec, tickets, or conversation.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

If there is no ticket, state the agreed result and its acceptance criteria as a short list before starting. This list is the spec for `code-review`. Note the base commit.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit your work to the current branch.

Once done, call the Skill tool with "code-review" to review the work since the base commit. Fix the findings you confirm, commit, and list the judgement calls you leave.

Then call the Skill tool with "ship" to deliver it.
