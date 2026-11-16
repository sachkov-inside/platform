# Human participation

How the owner takes part: what he sees, what he decides, and what agents settle without him.
[Ship](ship.md) applies these rules at delivery; [PR body](pr.md) presents the result.

## Two acceptances

- **Technical acceptance** asks whether the change is built correctly. It belongs to the
  implementer, CI and the independent reviewers. The owner takes no part in it and reads no code,
  in any zone, money and personal data included. A finding is technical when it is about how
  the change is built; a finding about what the user gets (a consequence for the user, money,
  access, personal data, an irreversible action, the look of the interface) is not, and in doubt
  it is not. Agents settle a technical finding among themselves: the implementer fixes it, or the
  reviewer withdraws it as optional with a reason; when they disagree, the implementer fixes it.
- **Business acceptance** asks whether this is the right thing and whether it works for the user.
  It belongs to the owner, who decides from evidence: video, screenshots, data and a way to check
  himself.

## Agree in the specification

When preparing a specification or a task, record with the owner:

- **Key scenarios**: what the owner wants to see when the work is done, as many as matter.
- **Advance decisions**: what the owner must decide before the work reaches it.

A task with no key scenario says "nothing to show". Tickets inherit the specification's scenarios
and decisions and add their own. Work without a ticket records them beside its acceptance criteria.
When the task touches the "always show" list of [owner attention](owner-attention.md), the
specification's author proposes those items as key scenarios. Raise a newly discovered check when its
decision is needed. An agreed check stays until the owner
resolves it; an agent cannot waive it.

## Consequence triggers

Judge what the change does. The paths it touches decide nothing: a comment in a
payment module triggers nothing, and a small change elsewhere can change who sees data. A
consequence brings the checks below; [owner attention](owner-attention.md) owns whether the owner
is called.

| Consequence | Checks when behaviour changes |
|---|---|
| Permissions, identity, sessions, data visibility or access revocation | Positive and negative authorization scenarios, Account isolation, direct and delegated access; a separate security review |
| Money: purchases, grants, subscriptions | Buyer and access contracts; repeated and concurrent events, transactional effects and recovery when affected; security review when trust or permissions change |
| Destructive or irreversible data changes, persistent data and jobs | Integration tests on real persistence; migration compatibility, rollback or stated irreversibility; retry, concurrency and crash recovery when affected |
| A business rule, a shared contract (REST, MCP, a provider boundary) or architecture that sets a new pattern | Schema and transport contracts, input validation, negative permission scenarios; security review for a new or changed trust boundary |
| A sent message or another external effect that cannot be recalled | The owner's permission before the action, under [Owner gates](../../AGENTS.md#owner-gates) |
| Legal text, publication, personal data | The owning product or legal contract; the owner's decision before the protected action |
| A user journey, interaction or message whose meaning needs judgement | The [verification](#verification) verdict on the running application; a new visual direction starts from the owner's choice of a prototype under [frontend delivery](frontend-delivery.md#delivery-contract) |
| CI, release controls, deployment | The delivery contract tests in `scripts/*.test.mjs`, their negative fixtures and recovery proof; security review when trust or credentials change |
| Agent authority: `AGENTS.md`, `CODING_STANDARDS.md`, skills, `docs/agents/` and their checks | `pnpm docs:check`; review under the rules on `main` before the change |

Assign a security review also for external input handling, secrets, or uncertain security
relevance. For a money or permissions consequence, a security review finding carries the command
that reproduces it and its output; an unproven finding is labelled an assumption.

The independent Spec reviewer compares the requirements, the agreed key scenarios, the complete
delivered diff and the current evidence. Its report carries notes on what may concern the owner: a
missed consequence, an unsupported "nothing to show", stale evidence. The classifier that
[ship](ship.md#owner-attention) runs reads those notes.

## Verification

Verification is its own step, by another agent, at the place root
[AGENTS.md](../../AGENTS.md#process) gives it in the skill chain. A fresh agent that did not write
the change runs it the way a user would, through the project skill
[`verify-platform`](../../.agents/skills/verify-platform/SKILL.md), and returns a verdict with artifacts: `PASS`, `PASS+NOTES` or `FAIL`.

- **Required** when user-visible behaviour changes or the task has key scenarios. An internal
  change or documentation needs none, and the PR says so in one line.
- **Separate from CI and review.** Green CI and a code review are not this verdict.
- **Bound to the task's change, not to a commit.** Compare by `git patch-id` or by the diff against
  the base. An edit to the task's code after the verdict needs a new verdict. A merge of
  `origin/main` without conflicts in the files the task touches keeps it.
- **Matched by the Spec reviewer.** The independent Spec reviewer confirms that the verdict
  covers the delivered change: in its review when the verdict already exists, otherwise in a short
  follow-up given the verdict and the diff, before `pr`. In the same pass it looks through the
  artifacts for data that is not test data.
- **`FAIL`** returns the work to implementation; its fix is reviewed and verified again.
  **`PASS+NOTES`** carries its notes into the PR's «Проверено».

## Evidence

The PR's «Проверено» is assembled from sources the implementer cannot embellish:

- CI results, by link to the run on the delivered head.
- The verifier's verdict with its artifacts.
- An agent's own observation, labelled «наблюдение агента».

Choose the kind of evidence for each scenario; one PR mixes them:

- **Video, 10 to 30 seconds**: movement, such as a transition, an animation or an order of actions.
- **Screenshot**: a look at one moment; two screenshots, before and after, when something existing
  changes.
- **Table "action, expected, got"**: what the screen does not show (permissions, money, database
  records), taken from the real backend and database. A screenshot proves only what is visible.
- **Numbers before and after**: speed, size, reliability.
- **One line**: nothing changes for the user.

Tests protect against regressions and are not the evidence the owner accepts from. Storybook is a
workshop: the running application proves the look a user gets.

The verifier puts the files and one `manifest.json` into `.evidence/` at the worktree's root,
outside Git; `verify-platform` owns the folder and the manifest. For each scenario the manifest
states the kind of evidence, the files, what they show in one line, the source of the data and the
change they cover. `pr` takes the scenarios of «Проверено» from the manifest, puts each into the
everyday words of [PR body](pr.md#sections) and adds no claim the manifest lacks.

Evidence lives in the PR; a specification keeps it in its final PR. No feature page holds it and
no script classifies a diff (owner decision 5 of #2206). The repository is public: evidence shows only test data. [PR body](pr.md#attachments) owns how artifacts get into the PR.

## Ask the owner

Ask when expected behaviour is missing or contradictory, requirements must change, a finding that is not technical needs
a decision, authority is insufficient, or an agreed check is due. Ask one concrete
question with a recommended answer and what it changes, under the choice rule of root
[AGENTS.md](../../AGENTS.md#human-facing-text). Link the issue or PR and the evidence, and name the
work that waits. Record the question in that issue or PR, pause the affected work and continue
independent assigned work. Silence is never an answer.
