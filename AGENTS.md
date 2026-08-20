# platform

## Repository role

Platform owns the future Membership application, its implementation issues and application-specific
ADRs. Product and cross-repository decisions are resolved in Workspace and arrive here through an
explicit issue or versioned artifact, never a machine-local dependency.

## Working agreements

- For GitHub triage or Wayfinder operations, read `docs/agents/issue-tracker.md` and
  `docs/agents/triage-labels.md`.
- For product context, terminology or ADR placement, read `docs/agents/domain.md`.
- For tracked work, branch from current `main` as `<type>/<issue>-<slug>`. Trivial docs/chore may
  use `<type>/<slug>`. Merge by squash only after explicit owner GO.

## Commands

The application toolchain has not been selected. Add install, run, build, test and deploy commands
after the owner approves the corresponding workflow.

<!-- inside-product-harness:start -->
## Inside product harness

This repository uses the versioned Sachkov Inside product harness.

- Shared skills installed in `.agents/skills/` are managed distribution artifacts. Change their
  canonical source in the Workspace harness, then run the explicit update command.
- Repository-specific instructions and skills remain owned by this repository. Give local skills
  unique names; do not shadow a managed skill.
- Invoke skills only when their descriptions match the task. Installing the suite does not make
  every workflow mandatory for every request.
- Keep this repository autonomous: build, test, run, and deploy must not depend on the Workspace
  repository or on machine-local paths.
- Treat user-level skills, MCP, plugins and hooks as unavailable. Declare every recurring
  capability in this repository's harness and keep credentials in native auth or environment.
- Do not edit `.inside-harness/` manually. Use the Workspace lifecycle commands and review the Git
  diff they produce.
<!-- inside-product-harness:end -->
