# Developer process

Pipeline skills in `.agents/skills` supply workflows; this contract owns project routes and owner overrides.
Keep synchronized skills unchanged. Put project exceptions here and verification commands in `AGENTS.md`.

## Routes

Choose the route from the owner's requested result. A follow-up keeps that route unless its scope changes.
Owner instructions and existing authorization take precedence over workflow defaults.

| Requested result | Route | Completion |
|---|---|---|
| Explanation, opinion, investigation, or discussion | Read and discuss | Answer with evidence; change files only when requested |
| Runnable design or state-model comparison | `prototype` | Show the requested variants and verify the interaction being evaluated |
| Documentation-only change | Edit, verify claims, review before integration | Pass `pnpm docs:check` and any check needed for the changed claims |
| Product implementation | Implement, review, pull request | Pass the product check in `AGENTS.md` on the final head and required CI |

A prototype remains outside production imports and uses fixtures or in-memory state for mutations.
For UI prototypes, use the existing Storybook foundation. Open the requested variants in a browser;
check relevant viewport sizes and the interaction that answers the design question. Share the URL as
soon as it works, with its limitations. Full-project checks, independent finish review, issue creation,
and a pull request are not prerequisites for this preview or prototype completion.
This scoped rule overrides general skill requirements for those delivery steps during prototyping.
Capture the proof and owner decision on a `prototype/*` branch before promotion or another-session handoff.
A selected variant records a direction; implementation starts when the owner's assignment includes it.

Production work can also receive early feedback through a local preview and focused checks.
An early preview does not claim final acceptance. Run full checks after implementation and review fixes
settle; repeat them when changed inputs or failures invalidate their evidence.

The owner starts `grilling`, `to-spec`, and `to-tickets` separately. Finish the requested stage and wait.
Preparation, status requests, and design selection do not start an unassigned implementation.
Before `ready-for-agent`, resolve owner decisions. Visual work follows
[frontend delivery](docs/agents/frontend-delivery.md): an accepted Storybook proof on `prototype/*`,
or temporary semantic UI with a linked integration ticket. After publishing child tickets, remove
`ready-for-agent` from the parent; this overrides `to-tickets`' restriction on modifying parents.
A `ready-for-agent` assignment runs through a ready PR without renewed approval.
Use `implement` for implementation. Acceptance criteria identify agreed seams for `tdd`;
write their failing tests first. A criterion with no behaviour needs no test.

## Sessions and coordinated execution

Keep single-session work in its current writing worktree. Use the owner's selected runtime and model;
otherwise inherit the current session. Codex work stays in Codex, including native review subagents.
Name another runtime or session only from verified runtime information.

Use [orchestrate](.agents/skills/orchestrate/SKILL.md) for coordinated specifications or task sets.
A specification uses one integration branch and final PR; independent tasks use separate PRs.
Delegate writing when independent ready tasks justify separate writers; a small task does not require dispatch.
Each writer owns a separate writing worktree. Dispatch through Herdr under the owner's worktree rules.
Use native subagents for read-only review. Serialize shared runtime/Compose operations under singleton ownership.

Keep the task map in issues and PRs: dependencies, decisions, session IDs, resource owners, commits,
checks, and next actions. On resumption reconcile actual state and assign only remaining work.
Preserve active workers and recovered results. Resume owner-paused work only on the owner's request.
Independent review precedes durable integration; review the integrated result when integration changes it.
A completion message or green CI alone does not establish acceptance.

## Blockers and acceptance

A defect outside the task that blocks it receives a linked issue labelled `ready-for-agent`.
Reuse its open `needs-triage` or `ready-for-agent` issue, or open one. Fix the blocker first.
If the task body grants merge permission, one revert undoes the fix, and the fix touches only tests,
CI, docs, or scripts outside release/deploy, copy the merge line into the blocker issue.
Otherwise use existing owner authorization or ask for the missing permission.
Work awaiting owner acceptance stays open with the specific decision recorded.

## Branch, worktree and pull request

Before writing an issue assignment, check remote branches and linked open PRs; Wayfinder uses its assignee.
Branch `<type>/<issue>-<slug>` from `origin/main`; untracked tasks use `<type>/<slug>`.
Types: `feat`, `fix`, `docs`, `chore`, `research`, `prototype`.
One session writes in one worktree. Reuse its task worktree for local iteration;
a separate writer needs a separate session and writing worktree.
New worktrees live at `<parent>/<repo>.worktrees/<task>`; `REPOSITORIES.md` owns the Inside layout.

The primary checkout belongs to the owner. Leave its tracked files unchanged; read it through `git -C`
or absolute paths. Only `session-cleanup` fast-forwards it after merge.
Preserve other sessions' worktrees, branches, containers, volumes, and stashes.
An independent delivery has one branch and PR; a specification retains its worker branches and worktrees.

For durable integration, push the first commit and open a draft PR. Link an existing issue when one exists.
Use `Closes #<issue>` on the final delivery PR and `Part of #<issue>` on earlier supporting PRs.
After pushing, integrate `origin/main` by merge; avoid rebase and force-push.
PR bodies use the owner's language and these sections: `Что сделано`, `Что нужно от владельца`,
`Проверка`, `Ревью`, `Риск merge`, and `Что дальше`. Apply `pr`; include unchecked limits.

## Review before integration

Record the base before changing files. Commit, then run `code-review` against the immutable task commit
from that base. Supply the assignment and applicable standards. Reviewers use native read-only subagents;
when unavailable, use a separate review process with the same inputs.
Each finding is fixed, moved to a linked issue, or rejected with evidence.
After fixes, review the changed findings again and record outcomes.
Prototype preview and intermediate feedback use the scoped completion rule under Routes.

## Completion and handoff

Completion follows the route under Routes. Preserve the command's actual exit code and checked scope.
Documentation-only delivery requires its focused checks; unrelated application suites are not a local completion gate.
Product delivery requires the full product check. Required CI must pass before integration.

For an integration PR:
1. Mark acceptance criteria and check required CI on the current head.
2. Diagnose and fix failures. Re-run a confirmed provider failure. An unaffected test/job failure gets
   one re-run with an open tracking issue; diagnose any repeated failure.
3. Compare `closingIssuesReferences` with the linked task before merge.
4. Use existing standing or task-specific merge authorization and the
   [merge queue](docs/runbooks/continuous-integration.md#merge-queue).

For a final handoff, state the result, actual checks, material limitations, and the next action.
Link the PR or requested artifact. A local preview update needs only its URL, scope, and relevant checks.
Run `session-cleanup` when the task ends; inspect and clean only resources owned by this session.
Preserve an owner review server while it is needed. Record its port, PID, cwd, source, and stop/restart
instructions before pane closure. A resource with changed ownership belongs to its new owner.
If no disposable resources remain, record that fact; avoid unrelated machine-wide inventories.
A preview link does not trigger server shutdown or final task cleanup.
The shared `report` skill and its HTML report are not completion requirements here.

## Owner corrections and gates

Turn mechanical failures into checks and judgement rules into their owning contract.
Apply `writing-for-agents` to agent instructions; use `retro` when the owner requests a retrospective.

Owner authorization is required for releases/deployments, publishing, paid actions, credentials,
external messages, and merges. Existing standing or task-specific authorization covers its stated scope
until withdrawn; follow it without asking again. Waiting for an answer is never consent.
