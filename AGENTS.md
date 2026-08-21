# platform

## Repository role

Platform owns its product brief, Membership application, implementation issues and
application-specific ADRs. Shared product and cross-repository decisions are resolved in Workspace
and arrive through linked issues; Platform work uses repository-local canonical documents, never a
machine-local dependency.

## Working agreements

- For GitHub triage or Wayfinder operations, read `docs/agents/issue-tracker.md` and
  `docs/agents/triage-labels.md`.
- For product context, terminology or ADR placement, read `docs/agents/domain.md`.

## Commands

Use Node.js and pnpm versions pinned in `.node-version` and `packageManager`.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm infra:up
pnpm smoke:health
pnpm infra:down
```

Run individual process adapters through the root `dev:web`, `dev:api`,
`dev:worker` and `dev:mcp` scripts. Keep infrastructure shutdown in the
verification path after a successful or failed smoke.

<!-- inside-product-harness:start -->
## Inside product harness

This repository uses the versioned Sachkov Inside product harness.

- For shared issue routing, branches, pull requests, readiness, Project status, and
  owner-controlled merge, read the repository-local `WORKFLOW.md`.
- Shared skills live once in `.inside-harness/skills/`; runtime discovery paths are relative links
  to that snapshot. Shared skills, `WORKFLOW.md`, triage labels, state, and the registry are managed
  artifacts: change their canonical package source and distribute it through the harness lifecycle.
- Repository-specific instructions and skills remain local. Give local skills unique names in the
  shared snapshot; do not shadow a managed skill.
- Invoke skills only when their descriptions match the task. Installing the suite does not make
  every workflow mandatory for every request.
- Runtimes without native project discovery search `.inside-harness/skills/REGISTRY.md` by intent
  and open only the matching `SKILL.md`.
- Keep this repository autonomous: build, test, run, deploy, and agent work must not depend on
  another repository, machine-local paths, or user-level skills, MCP, plugins, or hooks.
<!-- inside-product-harness:end -->
