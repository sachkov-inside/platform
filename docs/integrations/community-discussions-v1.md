# Community discussions integration v1

Telegram owns captured messages, discussions, status and source references.
The [Telegram protocol](../../apps/telegram/docs/integrations/community-discussions-v1.md) owns HTTP operations, pagination, retention and receipt semantics.
The [shared corpus](../contracts/inside-community-discussions-v1/README.md) owns synthetic examples for both applications.

## Author permission

The current Account needs `communications:manage` (or explicit `platform:admin`) and a confirmed Telegram link.
Platform checks the actual permission on every call and derives `actor.accountRef` from that link.
Telegram independently rechecks the current permission through the existing author authorization callback before receipt replay.
Tool input cannot supply an Account, actor, permission or destination.

[ADR 0024](../adr/0024-one-access-capability-vocabulary.md) owns the vocabulary of purchased access capabilities.
Its `community` capability permits access to a community. It does not authorize reading or managing participants' discussions.
`communications:manage` is an existing author permission owned by Accounts, outside that purchased-access vocabulary.
This integration adds no AccessCapability and grants no permission automatically.

## Delegated MCP

The author MCP connection exposes `community_discussions_list`, `community_discussions_read` and `community_discussions_mark` beside `material_create_draft`.
The learner MCP exposes none of these tools.
List and read are read-only. Mark changes the discussion status and Material references, without writing a Material.
Setting `new` removes a manual mark. Setting `used` requires Material URLs.

MCP fixes the contract version and operation. The caller supplies `requestId` and operation fields.
A list is one bounded page. Follow `nextCursor` until null to traverse all matching discussions.
After an uncertain mark response, retain the original `requestId` and complete input for an explicit retry.
The proxy performs no automatic retry and follows no redirects.
It validates the HTTP status, wire shape, operation, request ID and requested discussion identity.
Failures remain structured MCP errors. An unavailable provider never becomes an empty successful list.
The generated [tool surface](../../apps/backend/mcp/tool-surface.json) owns the registered names.

## Configuration

Configure both variables together for MCP. Without both, the proxy reports `provider_unavailable`; partial configuration fails startup.

| Variable | Meaning |
| --- | --- |
| `TELEGRAM_COMMUNITY_DISCUSSIONS_ENDPOINT` | Provider URL ending in `/integrations/platform/v1/community-discussions`, HTTPS or isolated loopback HTTP |
| `TELEGRAM_COMMUNITY_DISCUSSIONS_SECRET` | Dedicated credential matching Telegram `PLATFORM_COMMUNITY_DISCUSSIONS_SECRET` |

The credential must differ from every other Telegram integration credential.
Keep it in the private `mcp.env` file. URLs reject credentials, queries and fragments.
Telegram also needs the existing author callback settings described in the [communications integration](communications-v1.md#configuration-and-owner-bootstrap).
This configuration performs no production activation or paid provider call. Owner-only rollout remains #1957.
