# Telegram application

## Authority

This application lives in `apps/telegram` of `sachkov-inside/platform`.
Read [root AGENTS](../../AGENTS.md), [root WORKFLOW](../../WORKFLOW.md) and
[root coding standards](../../CODING_STANDARDS.md) for the shared process and toolchain.
The tracker is `sachkov-inside/platform`; [issue routing](docs/agents/issue-tracker.md)
explains legacy issue references during the transition.

## Application context

- For product scope, read [Telegram brief](docs/product/telegram-application-brief.md).
- For shared terms, read [root GLOSSARY](../../GLOSSARY.md); for bot-specific terms,
  read [application GLOSSARY](GLOSSARY.md).
- For community admission, read [community integration](docs/integrations/community-entitlements-v1.md)
  and [accepted specification](docs/specifications/community-and-notifications-v1.md).
- For author templates, communications API or authorization, read
  [communications integration](docs/integrations/communications-v1.md).
- For sales funnel events and consent, read [sales funnel integration](docs/integrations/sales-funnel-events-v1.md).
- For credentialed proof and unresolved setup inputs, read [seed decisions](docs/decisions/seed-decisions.md).
- For durable documentation changes, read [application documentation routing](docs/agents/documentation-maintenance.md).

## Verification

Run root `pnpm check` and `pnpm --filter @inside/telegram check:full` on the final head.
The full Telegram check needs an owned PostgreSQL database and non-guest RabbitMQ.
[Local development](README.md#local-development) describes the isolated project, free loopback
ports and `DATABASE_URL`, `NOTIFICATION_TEST_AMQP_URL`, `NOTIFICATION_TEST_MANAGEMENT_URL`.
Leave another session's worktree, infrastructure and database alone.

## Boundaries

Telegram owns BotContact lifecycle, linking, identity invariants, Membership observations,
reconciliation, MembershipEvidence and communication templates. Platform application capabilities
own Accounts, permissions, entitlements, profiles and content-access decisions.
Use authenticated runtime interfaces and pinned versioned corpora across that boundary.
Keep provider payloads, credentials and user data out of Git and redacted from evidence.
BotFather writes, administrator changes, marketing enablement and external messages follow
root `WORKFLOW.md` owner gates. Independent delivery uses root `telegram-release.yml` and `telegram-deploy.yml`;
[production runbook](docs/operations/production.md) owns publication, source trust and rollback.
