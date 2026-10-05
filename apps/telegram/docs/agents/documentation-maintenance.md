# Documentation maintenance

Follow [root maintenance contract](../../../../docs/agents/documentation-maintenance.md)
for shared product/legal facts, terminology and developer process.

| Telegram fact | Owner |
|---|---|
| Application scope | [Telegram brief](../product/telegram-application-brief.md) |
| Shared wire contract | Pinned versioned protocol under [docs/contracts](../contracts/) |
| Capability integration | Matching document under [docs/integrations](../integrations/) |
| Credentialed proof and bootstrap decisions | [Seed decisions](../decisions/seed-decisions.md) |
| Application run or recovery | Matching runbook under [docs/operations](../operations/) |
| Agent routing and verification | [Application AGENTS](../../AGENTS.md) |
| Delivery, review and skills | [Root WORKFLOW](../../../../WORKFLOW.md) and root `.agents/skills` |

Historical nested workflows remain fixtures until #960. Their tests preserve the old delivery
contract; the root Docker build interface already uses the monorepo context.
