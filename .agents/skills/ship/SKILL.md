---
name: ship
description: "Deliver assigned and reviewed work under the target project's rules. Use after implementation or when asked to deliver; the harness selects PR or main-checkout delivery, checks, acceptance and merge authority."
---

Read target root `AGENTS.md`, its delivery/testing/tracker/human-participation
pointers, and the assignment. Resolve the delivery mode and authority from them;
do not invent a fixed CI name, mandatory PR, owner handoff or deployment permission.

1. Check that the work matches the assignment and has required checks and
   independent review under the project's commit/review order. Record immutable
   checked commits or snapshot trees, findings and evidence limits.
2. Follow the selected mode. For a PR, push the owned branch, use `pr` for its body,
   create/update it through the tracker and follow draft timing. For an authorized
   main-checkout flow, run its checks/review and commit/push as that flow requires.
3. Verify current CI when the project requires it. Earlier green, pending, missing
   or cancelled checks do not establish success. Fix in-scope failures, rerun affected
   checks and repeat required independent review under the project's commit/review
   order. For pre-commit review, verify the delivered commit matches the reviewed tree.
4. Resolve human decisions due at this stage. Present the result, full delivered SHA,
   verification and its limits, and the owner's concrete next action when needed.
   Keep reviewed, accepted, merged and deployed states distinct.
5. Merge, deploy or publish only when the assignment and project gates authorize that
   concrete step. Follow required head guards, acceptance and queues. Otherwise stop
   at the project's defined handoff with the remaining gate explicit.
6. Retain or clean only owned resources under project lifecycle rules. Preserve active
   writers, unsaved work and unintegrated child results.
