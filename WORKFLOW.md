# Developer process

Session mode: worktree

Pipeline skills in `.agents/skills` supply workflows; this contract owns project completion requirements,
owner overrides and [skill exceptions](#skill-exceptions). Keep skills identical to their recorded workspace source.

## Terms

- **Durable integration**: a change prepared to land on `main` or on a specification's integration
  branch through a pull request. Discussion, previews and prototypes are not durable integration.
- **Manual skill**: a skill with `disable-model-invocation: true`; it runs when the owner invokes it or assigns its stage.
- **Stand**, **stack** and **Compose project**: [local stand terms](docs/runbooks/local-stand.md#terms).

## Completion requirements

Complete the owner's requested result within its assigned scope. A follow-up keeps that scope unless the owner changes it.
The owner selects pipeline stages and manual skills. An assignment to implement software or tooling work invokes
[implement](.agents/skills/implement/SKILL.md). An explicit request to implement a whole specification, including in
natural language, invokes [implement-spec](.agents/skills/implement-spec/SKILL.md) under
[coordinated execution](docs/agents/coordinated-execution.md).
An explicitly invoked skill completes its internal actions, including required subordinate skills, without renewed approval.
Preparation completes its own result and recommends the next stage; the owner assigns that stage separately.
Readiness labels, status requests, resumed chats, and repository membership supply context, not new execution assignments.
Ordinary writing, editing, research and material review follow the requested result and the
[domain/editorial contracts](docs/agents/domain.md), including author acceptance and publication gates.

| Owner-requested deliverable | Completion requirements |
|---|---|
| Explanation, opinion, investigation, or discussion | Answer with evidence; change files only when requested |
| Runnable design or state-model comparison | [Prototype](#prototypes): an accessible preview of the requested variants with the evaluated interaction verified |
| Documentation-only change | Verify claims, pass `pnpm docs:check` and focused checks, and review before integration; unrelated application suites are no local gate |
| Product implementation | Pass the product check named in `AGENTS.md` on the final head, independent review, and required CI |

Production work can receive early feedback through a local preview and focused checks; that preview claims no final
acceptance. Run full checks after fixes settle and repeat them when changed inputs or failures invalidate their evidence.

Before `ready-for-agent`, resolve owner decisions. Visual work follows
[frontend delivery](docs/agents/frontend-delivery.md): an accepted Storybook proof on `prototype/*`,
or temporary semantic UI with a linked integration ticket. An explicit implementation assignment
runs through a ready PR without renewed approval. Acceptance criteria identify agreed seams for `tdd`;
write their failing tests first. A criterion with no behaviour needs no test.

### Prototypes

A prototype remains outside production imports and uses fixtures or in-memory state for mutations.
For UI prototypes, use the existing Storybook foundation. Open the requested variants in a browser;
check relevant viewport sizes and the interaction that answers the design question. Share the URL as
soon as it works, with its limitations. Full-project checks, independent finish review, issue creation,
pull request and classification are not prerequisites for this preview or prototype completion;
this scoped rule overrides general skill requirements for those delivery steps.
Capture the proof and owner decision on a `prototype/*` branch before promotion or another-session handoff.
A selected variant records a direction; implementation starts when the owner's assignment includes it.

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
Every writing context stays in its assigned worktree, with one owner per writing worktree; reuse it for local iteration.
Use the environment-provided isolated worktree; CLI sessions without one create `<parent>/<repo>.worktrees/<task>`
(`REPOSITORIES.md` owns the canonical layout; existing worktrees keep their locations).

The primary checkout belongs to the owner. Leave its tracked files unchanged; read it through `git -C`
or absolute paths. Update it only when the owner assigns that action.
Preserve other sessions' worktrees, branches, containers, volumes, stashes, servers and results.
A resource with changed ownership belongs to its new owner.
An independent delivery has one branch and PR. A specification uses one integration branch and final PR;
its worker branches and worktrees remain until integration, and independent assigned tasks use separate PRs.

For durable integration, push the first commit and open a draft PR. Link an existing issue when one exists.
Use `Closes #<issue>` on the final delivery PR and `Part of #<issue>` on earlier supporting PRs.
After pushing, integrate `origin/main` by merge; avoid rebase and force-push.
PR bodies use the owner's language, include unchecked limits, and use these sections: `Что сделано`,
`Что нужно от владельца`, `Проверка`, `Ревью`, `Риск merge`, `Что дальше` (`pr` mapping in [skill exceptions](#skill-exceptions)).

## Review before integration

Record the base before changes. Commit, then run [code-review](.agents/skills/code-review/SKILL.md) on the immutable task commit.
The coordinator supplies root and applicable surface standards to Standards, and the assignment and acceptance criteria to Spec.
Keep reports separate. Reviewers inspect the diff through native read-only subagents; they do not delegate further reviews.
When native review is unavailable, keep it pending. The shared skill owns evidence, behavioral coverage, specialist triggers and convergence.
Record finding outcomes and review affected findings after fixes. Implementation loads a standard only for a concrete question.

## Change classification

Classification: enabled; policy: docs/agents/change-risk.md

For implementation and durable integration, including ordinary assignments, tickets and the final integrated
specification, invoke [classify-change](.agents/skills/classify-change/SKILL.md) under the [project policy](docs/agents/change-risk.md);
its advance acceptance, low-risk fast path and owner-ask format override the skill's defaults. Use trusted target
rules; a proposed policy cannot authorize its own merge. Deployment keeps its existing gates. Request the owner's
acceptance only when trusted policy or classification requires it; low/medium-risk authorized work may merge
automatically. Preserve unresolved decisions and evidence revisions in the existing issue/PR.

## Completion and handoff

Preserve each command's actual exit code and checked scope.
Reuse applicable successful evidence when its checked inputs are unchanged; record its source, scope, and outcome.
Product delivery requires successful final-head coverage under the
[verification evidence policy](docs/agents/release-evidence.md). Required current-head CI and merge-queue CI remain mandatory.

For an integration PR:

1. Mark acceptance criteria and check required CI on the current head.
2. Diagnose and fix failures. Re-run a confirmed provider failure. An unaffected test/job failure gets
   one re-run with an open tracking issue; diagnose any repeated failure.
3. Compare `closingIssuesReferences` with the linked task before merge.
4. Use existing standing or task-specific merge authorization and the
   [merge queue](docs/runbooks/continuous-integration.md#merge-queue).

For a final handoff, state the result, actual checks, material limitations and the next action, and link the PR or
artifact. A local preview update needs only its URL, scope and relevant checks, and triggers no cleanup.
When the task ends, run `session-cleanup` for resources this session owns. Keep an owner review server running
while it is needed; record its port, PID, cwd, source and stop/restart instructions before pane closure.

## Skill exceptions

These project rules replace the named parts of installed pipeline skills.

- `pr`: use the PR sections above; template `Summary` maps to `Что сделано`, `Evidence` to `Проверка`,
  and `Merge Danger` to `Риск merge`.
- `prototype`: UI variants follow [Prototypes](#prototypes) in Storybook, in place of `UI.md` sub-shapes A
  and B on application routes. Logic prototypes follow the skill.
- `to-spec`: publish the specification without a readiness label, as [triage labels](docs/agents/triage-labels.md) define.
- `to-tickets`: after publishing child tickets, remove `ready-for-agent` from the parent.
- `triage`: apply roles from [triage labels](docs/agents/triage-labels.md) and record a rejected request
  in its `wontfix` closing comment in place of `.out-of-scope/`.
- `implement-spec`: exploration notes stay inside the coordinator's worktree under the ignored
  `.reports/<specification>/` directory.

## Owner corrections

Follow [owner corrections](docs/agents/owner-corrections.md) after explicit corrective feedback.
This project extension preserves upstream `retro` as an owner-invoked retrospective.

## Owner gates

Owner authorization is required for releases/deployments, publishing, paid actions, credentials,
external messages, and merges. Existing standing or task-specific authorization covers its stated scope
across follow-ups and resumption until withdrawn; follow it without asking again. Waiting for an answer is never consent.
