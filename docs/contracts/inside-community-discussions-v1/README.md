# Community discussions v1

The canonical runtime Zod codecs live in [`../runtime/community-discussions.ts`](../runtime/community-discussions.ts).
Both applications import `@inside/contracts/community-discussions` and run the same `fixtures.json`.
`scenarios.json` records synthetic HTTP outcomes for valid requests, wrong/missing credentials, denied/revoked permission, unavailable authorization and malformed input.
Telegram runs those scenarios through its HTTP controller and real discussion module on PostgreSQL.
Platform checks provider status/body agreement against the same scenario responses.
`schema.json` is a generated structural projection, not a replacement for runtime refinements.
The runtime codec additionally enforces the relationship between mark status and Material URLs.
Regenerate with `pnpm --filter @inside/contracts discussions:generate`.
Check drift with `pnpm --filter @inside/contracts discussions:check`.

The [Telegram integration](../../../apps/telegram/docs/integrations/community-discussions-v1.md) owns protocol semantics.
The [Platform integration](../../integrations/community-discussions-v1.md) owns author permission, MCP identity and proxy configuration.
`snapshot.json` pins the originating specification and task. No production provider or participant data belongs in this corpus.
