# Matt Pocock principles and Platform harness comparison

Date: 2026-10-14.
Status: primary-source research and project recommendations, not proof of execution compliance.
Upstream snapshot: `mattpocock/skills@49dd158d1076134a641b33efb035946536778336`.
Project observations describe baseline `f4f2361a`, before this assignment's routing changes.
The implementation record below separates applied changes from remaining candidates.

## Evidence categories

- **Upstream rule**: an explicit instruction in a cited skill or upstream repository contract.
- **Advice**: a reasoned recommendation in upstream explanatory documentation.
- **Observation**: behavior described by inspected project files, not demonstrated runtime behavior.
- **Recommendation**: our proposed project change, informed by those sources.

Upstream rules govern the upstream skills. Platform's owner overrides govern Platform.
An intentional override is not automatically a defect.

## 1. Put judgment standards in review

**Upstream rule:** `retro` assigns coding standards to the reviewer rather than the implementation agent.
It explicitly places reading `CODING_STANDARDS.md` in review.
Implementation carries exploration, coding, and debugging; review can carry the standards.
Mechanical mistakes should become deterministic checks, while judgment-dependent rules become prose.
[`retro` source](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/retro/SKILL.md).

**Advice:** first-party documentation recommends lightweight steering files and standards for the reviewer.
It treats unwired existing checks as findings rather than inventing replacements.
Retro proposes changes; it does not authorize or apply them automatically.
[Matt Pocock, The /retro Skill](https://www.aihero.dev/skills-retro).

**Observation:** root and application `AGENTS.md` currently route standards to implementation and review.
`WORKFLOW.md` already requires independent review and turns mechanical failures into checks.
The installed retro reference matches upstream's review-only allocation.
See [the focused comparison](2026-10-14-matt-pocock-standards-review.md).

**Recommendation:** make standards routing explicitly review-only while preserving required task and runtime instructions.
Use task-specific references during implementation when needed.
Keep mandatory independent review; make mechanically checkable routing regressions fail documentation checks.

## 2. Use precise pointers and one owner per rule

**Upstream rule:** a context pointer names material and the conditions for reading it.
Sharpen weak triggers before inlining the target.
Keep universally needed steps visible; disclose material needed only by specific branches.
Keep one authoritative source per meaning.
Do not duplicate facts cheaply discoverable from configuration or commands.
[`writing-for-agents` source](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/productivity/writing-for-agents/SKILL.md).

**Observation:** [root AGENTS.md](../../AGENTS.md) already routes issue, domain, frontend, and verification branches to dedicated documents.
[WORKFLOW.md](../../WORKFLOW.md) owns project completion and overrides.
[PIPELINE.md](../../.agents/skills/PIPELINE.md) owns selected skill provenance and instructs keeping synchronized bodies unchanged.

**Recommendation:** retain these owners and change their pointers rather than duplicating rules in skills.
Review always-loaded root/application instructions for branch-specific material.
Split only when a concrete execution branch earns the extra file.
Line count alone is not evidence that a document needs splitting.

## 3. Preserve manual invocation boundaries

**Upstream rule:** user-invoked skills require the human to name them.
Claude metadata and Codex `policy.allow_implicit_invocation: false` must agree.
Another skill cannot invoke a user-invoked skill.
Model-invoked skills use meaningful trigger descriptions.
Operative dependencies explicitly call a model-invoked skill rather than relying on a bare slash-name.
[`invocation.md`](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/.agents/invocation.md).

**Observation:** Platform's documentation checker verifies manual-skill Codex policy.
`WORKFLOW.md` distinguishes ordinary actionable assignments from manual pipeline selection.
`PIPELINE.md` records this metadata requirement.

**Recommendation:** preserve that boundary.
Do not infer permission to invoke `to-spec`, `implement-spec`, or `retro` from a generic request alone.
Check invocation descriptions and metadata together when adding or updating skills.
Any additional checker must target an observed gap, not merely restate the existing policy check.

## 4. Test behavior in vertical slices

**Upstream rule:** test behavior through public interfaces.
Use independently derived expected results.
Build one failing test and minimal implementation per cycle, rather than all tests followed by all code.
The pinned skill asks owners to agree test seams and reserves refactoring for review.
[`tdd` source](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/tdd/SKILL.md).

**Observation:** Platform's `tdd` retains the behavior, red-before-green, vertical-slice, and review-refactoring rules.
Its seam selection is a documented shared adaptation: the implementer chooses routine seams from acceptance criteria.
`WORKFLOW.md` identifies acceptance criteria as agreed seams and exempts criteria without behavior from tests.

**Recommendation:** preserve this owner-approved autonomy.
Record the tested public boundary and the actual red/green commands in implementation evidence.
Do not require owner confirmation for routine test selection by importing upstream text blindly.
This research did not inspect implementation-session traces, so actual TDD compliance remains unverified.

## 5. Separate review axes and verify their scope

**Upstream rule:** Standards and Spec run in independent sub-agents.
Standards cites documented rules; Spec cites assignment requirements.
The coordinator discovers standards files, includes existing `CODING_STANDARDS.md`, and preserves separate reports.
[`code-review` source](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/code-review/SKILL.md).

**Advice:** prefer a fresh review context and verify cited findings.
Commit before reviewing the three-dot HEAD diff.
Avoid indefinite broad review/fix loops; inspect the cited findings and use focused follow-up checks.
Per-ticket and final-branch reviews can complement each other.
[Review documentation](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/docs/engineering/code-review.md).

**Observation:** Platform records an immutable review base, commits first, requires native read-only review, and rechecks changed findings.
Per-ticket and final integrated reviews are explicit owner overrides.
Its installed `code-review` has older, less explicit standards-discovery wording than the pinned snapshot.
`PIPELINE.md` documents a selective version set; this difference does not prove a failed synchronization.

**Recommendation:** require the project review brief to list root and applicable application standards explicitly.
Capture reviewed commits, both axes, finding dispositions, and focused fix rechecks.
Retain per-ticket reviews and avoid comparing an unfinished ticket against the entire future specification.

## 6. Keep context transitions deliberate

**Advice:** retain planning context through specification and ticket preparation.
Start each independent ticket from its self-contained assignment.
At phase boundaries, consider continuing before clearing, portability handoff, delegation, or compaction.
Summaries lose primary-source information; compaction is not a default first action.
[Router context guidance](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/ask-matt/SKILL.md),
[phase-boundary reference](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/ask-matt/PHASE-BOUNDARIES.md).

**Observation:** Platform uses isolated native workers and durable issue/PR context pointers.
It reconciles remaining assigned work on resumption and preserves recovered results.

**Recommendation:** keep assignments self-contained and reference source decisions rather than pasting long conversation summaries.
Separate reviewer context from authoring context.
Runtime-required automatic compaction still governs the session; upstream advice cannot disable it.

## 7. Treat implementation tickets as a graph

**Upstream rule:** `implement-spec` orchestrates a dependency graph with a ready frontier.
Implementers use isolated branches/worktrees based on the integration branch.
Merger workers integrate results; the coordinator updates the frontier.
Workers communicate through pointers, and final review occurs after all tickets land.
[`implement-spec` source](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement-spec/SKILL.md).

**Observation:** Platform preserves one integration branch, isolated native writers, and ownership of shared Compose resources.
Its per-ticket review and in-repository workflow ownership are project overrides.

**Recommendation:** keep resource serialization even when the dependency graph permits concurrent code work.
Include actual dependencies and acceptance contracts in tickets.
Avoid treating outside-repository research notes as durable cloud-session dependencies.
Do not overwrite these project constraints with an automatic upstream refresh.

## Project findings and applied changes

| ID | Finding | Disposition |
| --- | --- | --- |
| H-01 | Root and three application routers load coding standards before implementation. | Fixed: all four pointers now target review. Specific implementation questions may still consult references. |
| H-02 | The installed review skill describes discovery less explicitly than current upstream. | Fixed in the project authority: WORKFLOW requires root and every applicable surface standard in the Standards brief. Synchronized skills remain unchanged. |
| H-03 | Review findings can be aggregated without source validation; reviewer delegation can recurse. | Hardened: WORKFLOW requires validation against citations and direct review without recursive delegation. This closes a procedure gap, not a demonstrated incident in this project. |
| H-04 | The documentation checker did not protect review-stage standards routing. | Fixed: `checkStandardsReviewRouting` runs in `pnpm docs:check`; fixtures reject the former gates and permit targeted consultation. This is a narrow syntax check, not proof that an agent read or obeyed standards. |
| H-05 | Root AGENTS includes Compose-specific mechanics in every session. | Candidate: disclose those mechanics through the owning runbook if session traces show unnecessary loading. Retain the singleton trigger and data-ownership constraints. No routing loss was established. |
| H-06 | Web standards remain 290 lines, including prose descriptions of executable checks. | Candidate: classify existing rules by judgment versus enforceable syntax before pruning. Length is an attention signal, not proof of duplicate rules. Keep one rule authority and cite its check. |
| H-07 | Pipeline uses a documented selective version set. | Retain: differences alone do not justify a full refresh. Update specific skill behavior only through the owning workspace synchronization procedure. |
| H-08 | TDD seam autonomy, per-ticket plus final review, and singleton Compose go beyond upstream defaults. | Retain: these rules serve owner autonomy, small review scopes and a shared local runtime. Upstream advises independent review and scoped boundaries; it does not prohibit these adaptations. |
| H-09 | Cloud handoffs can lose unpublished local evidence or outside-repository exploration notes. | Preserve the existing in-repository dependency rule. #1466 is self-contained. Publish durable research through the normal documentation PR before relying on it from another checkout. |

Source inventory after routing edits: 33 local `SKILL.md` files, including 16 manual skills.
The documentation checker accepts every manual Codex policy.
Four `CLAUDE.md` entrypoints contain only `@AGENTS.md`, preserving one local instruction source.
Root/application routers are 71/45/40/43 lines. WORKFLOW is 148 lines.
Counts use the inspected files and exclude injected global skills and owner-profile instructions.

The root `check:static` includes `docs:check`; Application CI runs `check:static`.
The tooling test suite includes `agent-documentation-contract.test.mjs` through `scripts/*.test.mjs`.
These wiring facts come from [package.json](../../package.json),
[Application CI](../../.github/workflows/ci.yml), and
[the documentation checker](../../scripts/check-agent-documentation.mjs).
They establish configured coverage, not a successful current-head CI run.

Changed durable authorities: root/application AGENTS own context pointers; WORKFLOW owns review responsibilities;
the documentation checker owns mechanical enforcement. The pipeline source set was not changed.

## Verification and limits

Local focused verification passed after the routing and checker changes:
`pnpm docs:check`, all nine agent-documentation tests,
Oxlint for the two changed scripts, and `tsc -p tsconfig.scripts.json`.
The Web standards length warning remains advisory. No application behavior changed;
application test suites, provider CI and past-session trace audits are outside this local evidence.

Read the cited pinned upstream sources and the project routing, workflow, provenance, TDD, and review contracts.
Read the documentation checker's manual-invocation enforcement.
This is a source audit, not a measurement of context savings or an audit of every past execution trace.
Source-version observations are limited to explicitly compared text and documented provenance.
The parent session owns authorized routing edits, focused verification, and integration.
