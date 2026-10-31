# Worktree preparation and resources

Use this procedure to prepare an assigned writing worktree, run a task-owned preview, or finish its
local resources. [WORKFLOW.md](../../WORKFLOW.md#branch-worktree-and-pull-request) owns branch and
worktree lifetime; the [stand controller](local-stand.md) owns the singleton application stand.

## Prepare without starting the stack

Select the Node.js version in `.node-version` and pnpm in `packageManager` before using the host
commands. For example, with fnm and Corepack already available:

```bash
fnm use
corepack enable
pnpm --version
pnpm worktree:prepare --task <issue>
```

The project-owned `.worktree-resources.json` contains argv commands, executed without a shell.
Preparation installs dependencies with the frozen lockfile; it does not start services, migrate or
seed a database, create `.env`, or copy credentials. Repeating it reconciles the same dependencies.
The installed optional `agent-worktree` host CLI records successful preparation for the task.
Without that CLI, the same project command runs preparation and explicitly reports that resource
tracking is unavailable. No sibling checkout or global host CLI is needed to install dependencies.
Python 3 is required by the existing process supervisor used for preparation.

For checks, follow [repository verification](local-verification.md). Integration tests keep their
own Testcontainers databases, and browser launchers keep their dynamic ports. Preparing a worktree
needs no per-worktree PostgreSQL server. For a host application, configure local values using the
[host fallback](local-host-fallback.md) and [runtime configuration contract](runtime-configuration.md).
Create `.env` only when that selected workflow needs it; preserve existing values and source secrets
through the owning procedure. Shared stand ports, migrations and data remain under stand ownership.

pnpm uses its store to reuse dependencies between worktrees. Keep `node_modules`, `.next`, compiled
outputs and test artifacts local to each worktree. Inspect `pnpm store path` before changing its
location; machine-wide prune or cache deletion requires a separately scoped cleanup.

## Track a task-owned process

When the optional host CLI is installed, run it from this worktree. A simple Web preview against an
already configured backend can obtain its own port:

```bash
agent-worktree start --name web-preview --keep --port-env PORT -- pnpm dev:web
pnpm worktree:status
```

The host CLI allocates a port and records the owned process identity. `--keep` preserves this preview
when task cleanup runs. Application-specific API origins and callbacks still need the configuration
above; allocating one port does not configure a complete parallel stack. Use the stand controller
for a full application presentation and its reservation, rather than registering the shared stand
as a task-owned process. Testcontainers, Compose resources and other launchers retain their existing
owners and cleanup procedures.

Keep the task/PR handoff's port, PID, cwd, source commit, purpose and stop/restart instructions current.
Do not include secrets, tokens, environment contents or secret-bearing command arguments in the
resource record. To stop an owned preview explicitly:

```bash
agent-worktree stop --name web-preview
```

## Finish the session

Follow `session-cleanup`. Its `pnpm session:cleanup` prints a plan with a reason for each worktree
decision, for each process it would stop or that still serves a kept worktree, and for each old
temporary entry matching an explicit rule. The default run changes nothing; `--apply` acts on the
plan. The rules are the decisions in `planWorktree`, `planProcess` and `temporaryRules` of
[the script](../../scripts/session-cleanup.mjs); its header summarises them. Stashes, containers
and volumes are never changed. Removal needs a running Docker engine when Docker is installed:
without it, Compose use is unknown and candidate worktrees stay.

The project `.claude/settings.json` runs `--session-end` when a Claude Code session exits. It reports
this worktree's unpublished work and running processes, what can be removed elsewhere, and any
warning; it changes nothing. Claude Code shows SessionEnd output only for a non-zero status, so the
report arrives as a "SessionEnd hook ... failed" message in the terminal.

When a task used the host resource CLI, inspect `pnpm worktree:status`, then run
`pnpm worktree:cleanup` for its disposable tracked resources. The command preserves previews started
with `--keep`; record their continuing owner in the handoff. Without the CLI, status and cleanup
report its absence and change no resources. `pnpm session:cleanup` keeps a worktree while the CLI
tracks a process in it.
