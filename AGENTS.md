# platform

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
