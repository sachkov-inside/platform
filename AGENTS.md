# platform

## Repository role

Platform owns its product brief, Membership application, implementation issues and
application-specific ADRs. Shared product and cross-repository decisions are resolved in Workspace
and arrive through linked issues; Platform work uses repository-local canonical documents, never a
machine-local dependency.

## Working agreements

- For GitHub issue routing, Project fields, or Wayfinder operations, read
  `docs/agents/issue-tracker.md`.
- For readiness-label triage, read `docs/agents/triage-labels.md`.
- For product context, terminology or ADR placement, read `docs/agents/domain.md`.
- For frontend delivery or Storybook review, read `docs/agents/frontend-delivery.md`.
- For coding and review rules, read `CODING_STANDARDS.md`. Nested `AGENTS.md` files add
  surface-specific context and verification.
- When a change alters durable product behaviour, domain language, architecture, public contracts,
  developer commands, delivery workflows, or agent routing, follow the
  [documentation maintenance contract](docs/agents/documentation-maintenance.md) and run
  `pnpm docs:check` before handoff.

## Commands

The primary development stack requires Docker with Compose; host Node.js and pnpm are an optional
fallback and use the versions pinned in `.node-version` and `packageManager`.

```bash
docker compose up --build
bash scripts/compose-stack-smoke.sh
docker compose down
```

Run optional host process adapters through the root `dev:web`, `dev:api` and `dev:mcp` scripts.
Keep Compose shutdown in the verification path after a successful or failed smoke.
Before an agent runs repository Compose commands from any worktree, it must read and follow the
[singleton Compose ownership rule](docs/runbooks/local-development.md#parallel-worktrees-and-compose-ownership).

<!-- inside-product-harness:start -->
## Inside product harness

This repository uses the versioned Sachkov Inside product harness.

- For shared delivery rules and owner gates, read the repository-local `WORKFLOW.md` when the task
  touches issues, branches, pull requests, review, readiness, or merge.
- Native runtimes discover the selected skill profile through `.agents/skills` or `.claude/skills`.
  Fallback runtimes use `.inside-harness/skills/REGISTRY.md`: route by intent only to `Model` rows;
  open a `User` row only when the user names that skill.
- Managed skills and workflow files change in the canonical package and arrive through the harness
  lifecycle. Repository-specific skills stay local under unique names.
- Keep build, test, run, deploy, and agent work repository-local. Project-owned integrations may
  use native config; record them in `.inside-harness/integrations.json` without credentials.
<!-- inside-product-harness:end -->
