# platform

## Repository role

Platform owns the Membership application, the Telegram application under `apps/telegram`,
shared product/legal documents and the developer process of Inside. Applications keep separate
processes, databases, migrations and runtime contracts. `REPOSITORIES.md` maps current owners and
historical sources. Build, test and runtime depend only on this repository; a sibling checkout is
never a dependency.

## Routing

- Assignments, implementation, branches, pull requests, review, classification, merge, handoff or
  session coordination: read `WORKFLOW.md`. Its `Owner gates` list what needs the owner's approval.
- Issues, version and specification layers, sub-issues, blocking or Wayfinder: read
  `docs/agents/issue-tracker.md`.
- Readiness-label triage: read `docs/agents/triage-labels.md`.
- Product context, terminology or ADR placement: read `docs/agents/domain.md`.
- Frontend delivery, Storybook review or a UI prototype: read `docs/agents/frontend-delivery.md`.
- Before review, the Standards reviewer reads `CODING_STANDARDS.md` and the `CODING_STANDARDS.md`
  of each changed application.
- After an explicit owner correction: follow [owner corrections](docs/agents/owner-corrections.md).
- A change to durable product behaviour, domain language, architecture, public contracts, developer
  commands, delivery workflows or agent routing: follow the
  [documentation maintenance contract](docs/agents/documentation-maintenance.md), then run `pnpm docs:check`.

## Commands

- Product check: `pnpm check` on the final head, or exact-head CI under the
  [verification evidence policy](docs/agents/release-evidence.md).
- Docker with Compose runs the primary development stack; host Node.js and pnpm are an optional
  fallback pinned in `.node-version` and `packageManager`.
- Before any repository Compose command, read the [local stand runbook](docs/runbooks/local-stand.md):
  a running stand belongs to the owner or another session, and the Compose smoke runs only through
  its guarded recipe.

## Human-facing text

- In Russian, prefer ordinary Russian words to optional English terms. Keep code, commands, exact
  product or API names and established project terms; use only established abbreviations.
- Use periods, commas or parentheses in place of em dashes in replies and new human-facing copy,
  including site text.
- When offering a choice, name the decision, give each option a short everyday label and one
  sentence on what it changes, and mark the recommendation with its reason. When a choice depends
  on unmeasured facts, state the deciding criterion and what each outcome means.
