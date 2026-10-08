# Telegram application

## Authority

Before changing or reviewing Telegram code, apply the repository-wide rules in
[root coding standards](../../CODING_STANDARDS.md) and the boundaries below.

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
- For legacy `sachkov-inside/inside-telegram#N` issue references, read
  [issue routing](docs/agents/issue-tracker.md).
- For release, deployment, source trust and rollback, read
  [production runbook](docs/operations/production.md).

## Verification

Besides root `pnpm check`, run `pnpm --filter @inside/telegram check:full` on the final head. It
needs a PostgreSQL database and a non-guest RabbitMQ that this session owns;
[Local development](README.md#local-development) sets up the isolated project, free loopback
ports, `DATABASE_URL` and both `NOTIFICATION_TEST_*` URLs. Set that RabbitMQ user's credentials
only in `NOTIFICATION_TEST_AMQP_URL`; keep `NOTIFICATION_TEST_MANAGEMENT_URL` credential-free.

## Boundaries

Telegram owns BotContact lifecycle, linking, identity invariants, Membership observations,
reconciliation, MembershipEvidence and communication templates. Platform application capabilities
own Accounts, permissions, entitlements, profiles and content-access decisions.
Use authenticated runtime interfaces and the repository-local corpora in
[`@inside/contracts`](../../docs/contracts/README.md) across that boundary.
Keep provider payloads, credentials and user data out of Git and redacted from evidence.
BotFather writes, administrator changes, marketing enablement and external messages follow
root `WORKFLOW.md` owner gates.
