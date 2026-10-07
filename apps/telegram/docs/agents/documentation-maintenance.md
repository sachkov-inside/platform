# Documentation maintenance

Follow [root maintenance contract](../../../../docs/agents/documentation-maintenance.md)
for shared product/legal facts, terminology and developer process.

| Telegram fact | Owner |
|---|---|
| Application scope | [Telegram brief](../product/telegram-application-brief.md) |
| Shared wire contract | Repository-local schema/protocol under [docs/contracts](../../../../docs/contracts/README.md) |
| Capability integration | Matching document under [docs/integrations](../integrations/) |
| Credentialed proof and bootstrap decisions | [Seed decisions](../decisions/seed-decisions.md) |
| Application run or recovery | Matching runbook under [docs/operations](../operations/) |
| Agent routing and verification | [Application AGENTS](../../AGENTS.md) |
| Delivery, review and skills | [Root WORKFLOW](../../../../WORKFLOW.md) and root `.agents/skills` |

The [production runbook](../operations/production.md) owns the independent Telegram release,
deployment, exact source families and rollback. Root workflows execute that contract.
