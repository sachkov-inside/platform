# platform

Session mode: worktree

## Repository role

Platform owns the Membership application, the Telegram application under `apps/telegram`,
shared product/legal documents and the developer process of Inside. Applications keep separate
processes, databases, migrations and runtime contracts. `REPOSITORIES.md` maps current owners and
historical sources. Build, test and runtime depend only on this repository; a sibling checkout is
never a dependency.

## Process

Questions and discussion get answers; files change only on an explicit request. Readiness labels,
status requests and resumed chats are context, not an assignment.
Implementation runs the skill chain `implement` → `tdd` → `code-review` → `ship`; a whole
specification runs `implement-spec`. [PIPELINE.md](.agents/skills/PIPELINE.md) records the skills' source.

- Branches, worktrees, pull requests, blockers and handoff: [delivery](docs/agents/delivery.md).
- Merge permission, sensitive zones and owner acceptance: [ship](docs/agents/ship.md).
  PR body: [pr](docs/agents/pr.md).
- Several sessions or workers: [coordinated execution](docs/agents/coordinated-execution.md).
- Issues, specifications, sub-issues, blocking or Wayfinder: [issue tracker](docs/agents/issue-tracker.md).
  Readiness labels: [triage labels](docs/agents/triage-labels.md).
- Product context, terminology or ADR placement: [domain](docs/agents/domain.md).
- Frontend delivery, Storybook review or a prototype: [frontend delivery](docs/agents/frontend-delivery.md).
- Local application review or the shared stand: `.agents/skills/local-stand/SKILL.md`.
- Before review, the Standards reviewer reads `CODING_STANDARDS.md` and the `CODING_STANDARDS.md`
  of each changed application.
- After an explicit owner correction: follow [owner corrections](docs/agents/owner-corrections.md).
- A change to durable product behaviour, domain language, architecture, public contracts, developer
  commands, delivery workflows or agent routing: follow the
  [documentation maintenance contract](docs/agents/documentation-maintenance.md), then run `pnpm docs:check`.

## Commands

- Product change: `pnpm check` on the final head, or exact-head CI under the
  [verification evidence policy](docs/agents/release-evidence.md).
- Documentation-only change: `pnpm docs:check` and focused checks; application suites are not a local gate.
- Docker with Compose runs the primary development stack; host Node.js and pnpm are an optional
  fallback pinned in `.node-version` and `packageManager`.
- Before any repository Compose command, including the Compose smoke, read the
  [local stand runbook](docs/runbooks/local-stand.md) for stand ownership and the guarded recipe.

## Owner gates

Releases, deployments, publishing, paid actions, credentials, external messages and merges need the
owner's permission. Standing or task-specific permission covers its stated scope until withdrawn;
follow it without asking again. Waiting for an answer is never consent.

## Human-facing text

- In Russian, prefer ordinary Russian words to optional English terms. Keep code, commands, exact
  product or API names and established project terms; use only established abbreviations.
- Use periods, commas or parentheses in place of em dashes in replies and new human-facing copy,
  including site text.
- When offering a choice, name the decision, give each option a short everyday label and one
  sentence on what it changes, and mark the recommendation with its reason. When a choice depends
  on unmeasured facts, state the deciding criterion and what each outcome means.
