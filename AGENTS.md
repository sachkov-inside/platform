# platform

## Repository role

Platform owns the future Membership application, its implementation issues and application-specific
ADRs. Product and cross-repository decisions are resolved in Workspace and arrive here through an
explicit issue or versioned artifact, never a machine-local dependency.

Every PR starts from a Platform issue. For tracker operations and readiness roles read
`docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`. For vocabulary and ADR boundaries
read `docs/agents/domain.md`.

Create branches from current `main` as `<type>/<issue>-<slug>`. Keep one primary issue, one branch
and one PR per meaningful change. PRs use squash merge and require explicit owner GO; readiness for
review is never merge permission.

`main` is the only long-lived integration branch and represents a releasable state, not automatic
production exposure. Preview, staging and production are deployment environments, not branches.
Add a temporary `release/<version>` only when multiple production versions, a release freeze or an
external release train creates a real maintenance boundary; record its support and deletion rules.

## Commands

The application stack has not been selected, so repository commands are intentionally:

- install: `N/A`;
- run: `N/A`;
- build: `N/A`;
- test: `N/A`;
- deploy: `N/A`.

Replace these values only when the corresponding workflow actually exists in this repository.
Choosing a stack, database, auth, search or hosting is outside the current setup work.

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
