# platform

## Repository role

Platform owns the Membership application, the Telegram application under `apps/telegram`,
shared product/legal documents and the developer process of Inside. Applications keep separate
processes, databases, migrations and runtime contracts. `REPOSITORIES.md` maps current owners and
historical sources.

## Working agreements

- For issues, version and specification layers, sub-issues, blocking or Wayfinder, read
  `docs/agents/issue-tracker.md`.
- For readiness-label triage, read `docs/agents/triage-labels.md`.
- For product context, terminology or ADR placement, read `docs/agents/domain.md`.
- For frontend delivery or Storybook review, read `docs/agents/frontend-delivery.md`.
- Before review, read `CODING_STANDARDS.md` and the standards for each changed surface.
  Nested `AGENTS.md` files supply implementation context and verification.
- For implementation or durable integration, apply [change classification](docs/agents/change-risk.md)
  through the installed `classify-change` skill, including ordinary assignments outside manual skills.
- After an explicit owner correction, follow [owner corrections](docs/agents/owner-corrections.md)
  to fix the work and preserve the applicable requirement.
- When a change alters durable product behaviour, domain language, architecture, public contracts,
  developer commands, delivery workflows, or agent routing, follow the
  [documentation maintenance contract](docs/agents/documentation-maintenance.md) and run
  `pnpm docs:check` before handoff.

## Commands

Verification follows the requested deliverable in [WORKFLOW.md](WORKFLOW.md#completion-requirements).
For completion evidence and release preparation, read the
[verification evidence policy](docs/agents/release-evidence.md). It defines exact-source CI reuse,
coverage gaps, and local fallbacks.

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

- `WORKFLOW.md` owns session mode, classification and the developer process. Skills live in
  `.agents/skills`; `.claude/skills` is a symlink to them. Read `WORKFLOW.md` when the task touches issues, branches, pull requests,
  review, readiness, merge, or handoff. `Owner gates` there lists what needs the owner's approval.
- For session handoff, assigned coordination, or an explicit whole-specification implementation
  request via [implement-spec](.agents/skills/implement-spec/SKILL.md) (including natural language),
  read [session execution](WORKFLOW.md#sessions-and-coordinated-execution).
  `WORKFLOW.md` owns stage selection and ordinary task completion.
- Keep build, test, run, deploy, and agent work dependent only on files in this repository.

## Human communication

- Speak to the user in their language. In Russian, prefer ordinary Russian words over optional
  English terms. Keep code, commands, exact product or API names, and established project terms
  unchanged. Do not invent abbreviations.
- Use periods, commas or parentheses instead of em dashes in replies and new human-facing copy.
- Lead with what happened or what must be decided and why it matters. Use short, natural sentences
  with one idea each. Remove filler, but keep normal grammar.
- Use an unfamiliar specialist term only when it is needed for the current decision. Explain it in
  plain words on first use.
- When offering a choice, name the decision directly. Give each option a short everyday label and
  one sentence explaining what it changes. Mark the recommendation and explain its reason plainly.
- When a choice depends on facts not yet measured, state the criterion that decides it and what
  each outcome of the measurement means, so whoever measures can apply it without a new decision.
