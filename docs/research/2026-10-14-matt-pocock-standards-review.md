# Matt Pocock: coding standards belong to review

Date: 2026-10-14.
Status: primary-source research; no process change applied.
Historical comparison: project instructions at `f4f2361a`, before the owner's follow-up assignment.
The [broader harness audit](2026-10-14-matt-pocock-harness-principles.md) records the authorized changes.
Upstream snapshot: `mattpocock/skills@49dd158d1076134a641b33efb035946536778336`.

## Answer

Matt explicitly recommends reading `CODING_STANDARDS.md` during review rather than implementation.
This is stated guidance, not an inference from an omitted implementation step:

> this file is read during review, not implementation.

[Pinned upstream retro skill, Files section](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/retro/SKILL.md#files).

The implementer must explore, write code, and debug, which creates greater context pressure.
The reviewer receives a diff and can carry the standards instead.
Matt therefore assigns standards enforcement to the reviewer.
[Pinned upstream retro skill, Implementation vs Review](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/retro/SKILL.md#implementation-vs-review).

His first-party article confirms this allocation.
Mechanically detectable mistakes belong in deterministic checks.
Judgment-dependent mistakes belong in standards that the reviewer reads.
Always-loaded `AGENTS.md` should primarily supply navigation pointers.
[Matt Pocock, The /retro Skill](https://www.aihero.dev/skills-retro#where-the-findings-land).

## How the review enforces this

`code-review` discovers the repository's standards sources and includes existing `CODING_STANDARDS.md` files.
It gives those sources and the diff to a Standards sub-agent.
That sub-agent cites the standards file and rule for each documented violation.
A separate Spec sub-agent checks the originating assignment.
The reports stay separate so success on one axis cannot hide failure on the other.
[Pinned upstream code-review skill](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/code-review/SKILL.md).

The documentation recommends independently checking findings rather than treating them as proof.
It also recommends a fresh review session to reduce authoring-context bias.
[Pinned upstream code-review documentation](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/docs/engineering/code-review.md#common-questions).

## Comparison with this project

The installed [retro skill](../../.agents/skills/retro/SKILL.md#implementation-vs-review) contains the same review-only guidance.
At the comparison baseline, repository instructions loaded standards during implementation too:

- [Root AGENTS.md](../../AGENTS.md) routes coding and review to `CODING_STANDARDS.md`.
- [Backend AGENTS.md](../../apps/backend/AGENTS.md) requires standards before changing or reviewing backend code.
- [Web AGENTS.md](../../apps/web/AGENTS.md) requires standards before changing or reviewing Web code.
- [Telegram AGENTS.md](../../apps/telegram/AGENTS.md) requires root standards before changing or reviewing Telegram code.

These instructions take precedence locally, so agents following them are obeying this project's policy.
But their standards-loading policy differs from Matt's recommendation.
The previous explanation correctly described local instructions, but missed this explicit upstream distinction.

[WORKFLOW.md](../../WORKFLOW.md#review-before-integration) already requires independent review with the assignment and applicable standards.
It also requires per-ticket review and a separate final integrated-specification review.
That review requirement is compatible with Matt's separation of implementation and standards enforcement.

## Suggested direction, pending owner assignment

Keep mandatory independent Standards and Spec reviews.
Route judgment-based standards to review rather than loading every standard before implementation.
Keep task requirements, essential execution instructions, and relevant runtime constraints available to implementers.
Put mechanically detectable rules into checks and verify those checks run.
An implementer can consult reference material when needed; review-only loading does not forbid targeted consultation.

This direction is a project recommendation inferred from the cited allocation of responsibilities.
It is not an upstream claim that implementers should ignore task correctness, tests, or execution requirements.

## Verification boundary

Read the pinned upstream retro and code-review sources, first-party retro article, and local routing instructions.
Confirmed the upstream commit through GitHub's repository API.
No product files, agent-routing instructions, issues, commits, or pull requests changed during this research.
