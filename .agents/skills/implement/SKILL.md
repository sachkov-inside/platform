---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

For a project with classification enabled in `AGENTS.md` or `WORKFLOW.md`, invoke `classify-change` provisionally before implementation.
A missing configured policy leaves automatic completion pending; unconfigured projects keep their existing route.

Call the Skill tool with "tdd" where possible, at pre-agreed seams.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Commit the implementation to the current branch before actual-change classification and diff-based review.

After initial implementation, invoke `classify-change` for actual-change risk before finalizing review and verification in enabled projects.
Complete its assigned checks and call the Skill tool with "code-review" to review the work.
Before any planned protected boundary, invoke or reuse applicable participation assessment and satisfy its conditions.

Maintain relevant project risk facts in the same change. Follow `classify-change` for authority changes and trusted prior policy.

Commit each set of review fixes before affected re-review and reassess conclusions invalidated by those fixes.

For an enabled project, assess participation on the actual prepared result and verify risk/evidence applicability through `classify-change`.
If fixes change relevant inputs, reassess affected conclusions. Record evidence and next actions in the existing issue/PR.
Complete only the assigned delivery stage under project workflow; classification does not grant merge or deployment authorization.
