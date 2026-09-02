# Documentation maintenance

Use this contract when a change alters durable product behaviour, domain language, architecture,
public contracts, developer commands, delivery workflows, or agent routing. The goal is one current
source of truth for every durable fact, not a prose copy of every implementation detail.

## Choose the authority

| Changed fact | Update |
|---|---|
| Product scope or user-visible behaviour | `docs/product/platform-mvp-brief.md` and the owning specification when its contract changes |
| Domain term, meaning, or relationship | `CONTEXT.md`; keep implementation and history out of the glossary |
| Hard-to-reverse or surprising trade-off | Add an ADR, or let the replacement ADR supersede the old decision explicitly; do not rewrite accepted history as if it never happened |
| Repository-wide coding rule | Root `CODING_STANDARDS.md`; keep it a short router and shared contract |
| Backend module seam, slice layout, DI, persistence, REST, or import rule | `apps/backend/CODING_STANDARDS.md` for the current rule and the relevant ADR for rationale |
| Web slice, runtime, transport, server-state, mutation, or UI implementation rule | `apps/web/CODING_STANDARDS.md` for the current rule and the relevant ADR for rationale |
| REST contract | Controller schemas, generated OpenAPI, and the generated Web client; `pnpm api:check` owns drift detection |
| Development, test, run, configuration, or deployment procedure | The owning README or runbook; keep exact executable commands in package/config files |
| Agent trigger, routing, verification, or completion rule | The nearest `AGENTS.md` or `docs/agents/` contract; do not copy product/domain explanations into agent files |
| Managed product-harness workflow | Change the canonical harness package and distribute it through the harness lifecycle; do not edit managed copies locally |

Code, schemas, generated contracts, and tests may be the complete authority for a local
implementation detail. In that case, record `None — code/schema/tests are the authority` in the PR
Documentation impact section instead of making a no-op documentation edit.

## Close the change

1. Inspect the diff and list every changed durable fact covered by the trigger above.
2. Update each fact in exactly one authority from the table. Update pointers to that authority and
   remove or clearly supersede current claims that now conflict with it.
3. Update `AGENTS.md` only when the agent's trigger, routing, rule, verification command, or
   completion criterion changed.
4. Run `pnpm docs:check`, then the focused verification for the changed surface. Run root
   `pnpm check` before handoff when code or executable contracts changed.
5. In the PR Documentation impact section, name the authorities changed or state why no prose
   authority was required.

Completion means every changed durable fact has one named authority, every local agent pointer
resolves, superseded decisions are not presented as current instructions, generated contracts have
no drift, and `pnpm docs:check` passes.
