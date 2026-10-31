# Ship

The `ship` skill reads this file from `main`. It adds Platform's merge permission, advance
acceptance, sensitive zones and the checks each zone needs.

## Merge permission

A merge needs the owner's permission: in the assignment, the Issue, or the conversation.
Standing permission covers its stated scope until the owner withdraws it. Merge through the
[merge queue](../runbooks/continuous-integration.md#enqueue-a-checked-pull-request). `CI Gate` and
merge-queue CI stay required.

## Advance acceptance

Owner decision 1 (2026-10-22): an assignment to finish through merge, such as «сделай всё до конца»,
accepts the prepared result in advance, except production, money and legal effects; standing
merge permission alone is not such an assignment.

## Sensitive zones

The zones add to the ones `ship` always checks. Classify the actual behaviour change: a comment in a
sensitive module stays outside the zone, and a small change elsewhere can enter it.

| Zone | Paths | Checks when behaviour changes |
|---|---|---|
| Accounts, sessions, permissions, content access | `apps/backend/src/modules/{identity-principals,accounts,account-rights,content-access}`, `apps/web/src/shared/auth`, `apps/web/src/features/account-*`, `apps/telegram/src/security` | Positive and negative authorization scenarios, Account isolation, direct and delegated access; separate security review |
| Money: purchases, grants, subscriptions | `apps/backend/src/modules/{billing,products,telegram-membership}`, `apps/web/src/features/{billing-*,payment-links,owner-payments,product-order,product-sale-settings}`, `apps/web/src/entities/subscription*` | Buyer and access contracts; repeated and concurrent events, transactional effects and recovery when affected |
| Persistent data and jobs | `apps/backend/src/migrations`, `apps/backend/prisma`, `apps/telegram/src/database` | Integration tests on real persistence; migration compatibility, rollback or stated irreversibility; retry, concurrency and crash recovery when affected |
| External REST, MCP and provider boundaries | `apps/backend/openapi`, `apps/backend/mcp`, backend controllers, `apps/web/src/shared/api`, `apps/telegram/src/adapters` | Schema and transport contracts, input validation, negative permission scenarios; security review for a new or changed trust boundary |
| Legal text, publication, personal data | `docs/legal`, `apps/web/src/features/{terms-acceptance,accepted-documents,member-profile-editor,client-telemetry}`, `apps/web/src/entities/legal-document`, `apps/backend/src/modules/{member-profiles,account-profiles,web-telemetry}` | The owning product or legal contract; the owner's decision before the protected action |
| CI, release, deployment | `.github/workflows`, `scripts/*release*`, `scripts/production-*`, `apps/backend/src/release`, `infra`, `apps/telegram/infra` | The delivery contract tests in `scripts/*.test.mjs`, their negative fixtures and recovery proof; security review when trust or credentials change |
| Agent instructions | `AGENTS.md`, `CODING_STANDARDS.md`, `docs/agents`, `.agents/skills`, `scripts/check-agent-documentation.mjs` | `pnpm docs:check`; review under the rules on `main` before the change |

Assign a security review also for external input handling, secrets, or uncertain security relevance.
Visual work keeps the owner acceptance gates of [frontend delivery](frontend-delivery.md).

## CI failures

A failure unrelated to the diff gets one re-run. Before it, open or reuse an Issue that names the
test or cause and the first failed run. A recurring cause raises its diagnosis priority and gives no
new re-run; a failure that then passes is not proof of a flaky test. The
[CI runbook](../runbooks/continuous-integration.md) describes recovery and the history report.
