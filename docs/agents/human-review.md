# Human review

How the owner takes part: what he sees, what he decides, and what agents settle without him.
[Ship](ship.md) applies these rules at delivery; [PR body](pr.md) presents the result.

## Two acceptances

- **Technical acceptance** asks whether the change is built correctly. It belongs to the
  implementer, CI and the independent reviewers. The owner takes no part in it and reads no code,
  in any zone, money and personal data included.
- **Business acceptance** asks whether this is the right thing and whether it works for the user.
  It belongs to the owner, who decides from evidence: video, screenshots, data and a way to check
  himself.

## Agree in the specification

When preparing a specification or a task, record with the owner:

- **Key scenarios**: what the owner wants to see when the work is done, as many as matter.
- **Advance decisions**: what the owner must decide before the work reaches it.

A task with no key scenario says "nothing to show". Tickets inherit the specification's scenarios
and decisions and add their own. Work without a ticket records them beside its acceptance criteria.
Raise a newly discovered check when its decision is needed. An agreed check stays until the owner
resolves it; an agent cannot waive it.

## Consequence triggers

Judge what the change does. Its size and the paths it touches decide nothing: a comment in a
payment module triggers nothing, and a small change elsewhere can change who sees data. A trigger
means two things: the change gets the checks below, and the owner inspects or decides the named
result from evidence.

| Consequence | Checks when behaviour changes |
|---|---|
| Permissions, identity, sessions, data visibility or access revocation | Positive and negative authorization scenarios, Account isolation, direct and delegated access; a separate security review |
| Money: purchases, grants, subscriptions | Buyer and access contracts; repeated and concurrent events, transactional effects and recovery when affected; security review when trust or permissions change |
| Destructive or irreversible data changes, persistent data and jobs | Integration tests on real persistence; migration compatibility, rollback or stated irreversibility; retry, concurrency and crash recovery when affected |
| A business rule, a shared contract (REST, MCP, a provider boundary) or architecture that sets a new pattern | Schema and transport contracts, input validation, negative permission scenarios; security review for a new or changed trust boundary |
| Legal text, publication, personal data | The owning product or legal contract; the owner's decision before the protected action |
| A user journey, interaction or message whose meaning needs judgement | The [verification](#verification) verdict on the running application; visual work keeps the gates of [frontend delivery](frontend-delivery.md#delivery-contract) |
| CI, release controls, deployment | The delivery contract tests in `scripts/*.test.mjs`, their negative fixtures and recovery proof; security review when trust or credentials change |
| Agent authority: `AGENTS.md`, skills, `docs/agents/` and their checks | `pnpm docs:check`; review under the rules on `main` before the change |

Assign a security review also for external input handling, secrets, or uncertain security
relevance. Missing or conflicting expectations, insufficient evidence and a scenario only a human
can reach are triggers too.

Two readers apply the triggers. The implementer applies them in `ship`. The independent Spec
reviewer applies them separately to the requirements, the agreed key scenarios, the complete
delivered diff and the current evidence, and reports missed triggers, an unsupported "nothing to
show" and stale evidence. A trigger either of them finds counts.

## Verification

Verification is its own step, by another agent: `implement` → `tdd` → `code-review` →
verification → `pr` → `ship`. A fresh agent that did not write the change runs it the way a user
would, through the project skill `verify-platform`, and returns a verdict with artifacts:
`PASS`, `PASS+NOTES` or `FAIL`.

- **Required** when user-visible behaviour changes or the task has key scenarios. An internal
  change or documentation needs none, and the PR says so in one line.
- **Separate from CI and review.** Green CI and a code review are not this verdict.
- **Bound to the task's change, not to a commit.** Compare by `git patch-id` or by the diff against
  the base. An edit to the task's code after the verdict needs a new verdict. A merge of
  `origin/main` without conflicts in the files the task touches keeps it.
- **Checked twice.** `ship` confirms that the verdict matches the delivered change. A Spec
  review that runs after a verdict, such as a re-review of corrections, confirms the same.
- **`FAIL`** returns the work to implementation; its fix is reviewed and verified again.
  **`PASS+NOTES`** carries its notes into the PR, outside any disclosure.

## Evidence

The PR's «Как проверено» is assembled from sources the implementer cannot embellish:

- CI results, by link to the run on the delivered head.
- The verifier's verdict with its video and screenshots.
- An agent's own observation, labelled «наблюдение агента».

What each kind proves:

- A screenshot proves only what is visible. Permissions, money and side effects need evidence at
  the boundary where they happen: the real backend and database.
- Tests protect against regressions. They are not the evidence the owner accepts from.
- Storybook is a workshop. The running application proves the look a user gets.

Evidence lives in the PR; a specification keeps it in its final PR. There is no separate feature
page and no script that classifies a diff. The repository is public: evidence shows only the
stand's test data. [PR body](pr.md#attachments) owns how artifacts get into the PR.

## Ask the owner

Ask when expected behaviour is missing or contradictory, requirements must change, a finding needs
a disputed decision, authority is insufficient, or an agreed check is due. Ask one concrete
question with a recommended answer and what it changes, under the choice rule of root
[AGENTS.md](../../AGENTS.md#human-facing-text). Link the issue or PR and the evidence, and name the
work that waits. Record the question in that issue or PR, pause the affected work and continue
independent assigned work. Silence is never an answer.
