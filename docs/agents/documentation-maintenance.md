# Documentation maintenance

Use this contract when a change alters durable product behaviour, domain language, architecture,
public contracts, developer commands, delivery workflows, or agent routing. The goal is one current
source of truth for every durable fact, not a prose copy of every implementation detail.

## Choose the authority

| Changed fact | Update |
|---|---|
| Product scope or user-visible behaviour | `docs/product/platform-mvp-brief.md` and the owning specification when its contract changes |
| Domain term, meaning, or relationship | `GLOSSARY.md`; keep implementation and history out of the glossary |
| Hard-to-reverse or surprising trade-off | Add an ADR, or let the replacement ADR supersede the old decision explicitly; do not rewrite accepted history as if it never happened |
| Repository-wide coding rule | Root `CODING_STANDARDS.md`; keep it a short router and shared contract |
| Backend module seam, slice layout, DI, persistence, REST, or import rule | `apps/backend/CODING_STANDARDS.md` for the current rule and the relevant ADR for rationale |
| Web slice, runtime, transport, server-state, mutation, or UI implementation rule | `apps/web/CODING_STANDARDS.md` for the current rule and the relevant ADR for rationale |
| REST contract | Controller schemas, generated OpenAPI, and the generated Web client; `pnpm api:check` owns drift detection |
| MCP tool set | The registering module and the generated `apps/backend/mcp/tool-surface.json`; `pnpm mcp:check` owns drift detection |
| Development, test, run, configuration, or deployment procedure | The owning README or runbook; keep exact executable commands in package/config files |
| Agent trigger, routing, verification, or completion rule | The nearest `AGENTS.md` or `docs/agents/` contract; do not copy product/domain explanations into agent files |
| Skill copied from upstream | Replace the directory from upstream and update `.agents/skills/UPSTREAM.md`; do not edit the copy locally |

Code, schemas, generated contracts, and tests may be the complete authority for a local
implementation detail. In that case, say `None — code/schema/tests are the authority` in the pull
request instead of making a no-op documentation edit.

## Close the change

List the changed durable facts from the final diff, update each in exactly one authority from the
table above, and name the result in the pull request. Then:

1. Update `AGENTS.md` only when the agent's trigger, routing, rule, verification command, or
   completion criterion changed.
2. Run `pnpm docs:check`, then the focused verification for the changed surface. Run root
   `pnpm check` before handoff when code or executable contracts changed.

Completion means every changed durable fact has one named authority, every local agent pointer
resolves, superseded decisions are not presented as current instructions, generated contracts have
no drift, and `pnpm docs:check` passes.
