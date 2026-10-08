# platform

Режим агентов: worktree

## Repository role

Platform owns the Membership application, the Telegram application under `apps/telegram`,
shared product/legal documents and the developer process of Inside. Applications keep separate
processes, databases, migrations and runtime contracts. `REPOSITORIES.md` maps current owners and historical sources;
Telegram has independent root release/deploy workflows; its delivery authority is
`apps/telegram/docs/operations/production.md`. Work uses only
repository-local canonical documents.

## Working agreements

- For GitHub issue routing or Wayfinder operations, read `docs/agents/issue-tracker.md`.
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

`pnpm check` is the check that defines done: it must be green on the final head. `pnpm check:full`
and the Compose smoke below are the checks before a release.

The primary development stack requires Docker with Compose; host Node.js and pnpm are an optional
fallback and use the versions pinned in `.node-version` and `packageManager`.

Run Compose smoke through the [guarded recipe](docs/runbooks/local-development.md#start-from-a-fresh-clone)
so build, smoke and shutdown hold one shared local slot. This verification needs host Python 3
and Bash; it does not need host Node.js or pnpm.

The smoke runs in its own disposable Compose project on the same ports, so the shared
`inside-platform` stand must be stopped first; the stand keeps the owner's product data (see the
local product view in the runbook).

Run optional host process adapters through the root `dev:web`, `dev:api` and `dev:mcp` scripts.
Keep Compose shutdown in the verification path after a successful or failed smoke.
Before an agent runs repository Compose commands from any worktree, it must read and follow the
[singleton Compose ownership rule](docs/runbooks/local-development.md#parallel-worktrees-and-singleton-ownership).

## Process

- The developer process is `WORKFLOW.md` plus the skills in `.agents/skills`; `.claude/skills` is a
  symlink to them. Read `WORKFLOW.md` when the task touches issues, branches, pull requests,
  review, readiness, or merge. `Owner gates` there lists what needs the owner's approval.
- Merge procedure: a merge goes through the merge queue; follow
  [Merge queue](docs/runbooks/continuous-integration.md#merge-queue).
- The owner starts grilling, the specification and the ticket breakdown, each with its own command.
  A `ready-for-agent` implementation task runs to a ready pull request without stopping.
- Start a development session in this repository so its rules and skills load; a parent directory
  does not carry them.
- Keep build, test, run, deploy, and agent work repository-local.

## Human communication

- Speak to the user in their language. In Russian, prefer ordinary Russian words over optional
  English terms. Keep code, commands, exact product or API names, and established project terms
  unchanged. Do not invent abbreviations.
- Lead with what happened or what must be decided and why it matters. Use short, natural sentences
  with one idea each. Remove filler, but keep normal grammar.
- Use an unfamiliar specialist term only when it is needed for the current decision. Explain it in
  plain words on first use.
- When offering a choice, name the decision directly. Give each option a short everyday label and
  one sentence explaining what it changes. Mark the recommendation and explain its reason plainly.
- When a choice depends on facts not yet measured, state the criterion that decides it and what
  each outcome of the measurement means, so whoever measures can apply it without a new decision.
