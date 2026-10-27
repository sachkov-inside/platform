# Communications integration v2

The stable filename preserves existing links. Current transport is `inside-communications-v2`.
The [Telegram integration](../../apps/telegram/docs/integrations/communications-v1.md) owns the
complete Sequence, Participation, author-menu, delivery and scheduler contract. The accepted
[domain model](../specifications/domain-model-refactoring-v1.md) owns product semantics.
The pinned v1 corpus remains historical; it does not enable old writable commands or routes.

## Editor ownership

The Telegram bot author menu and delegated MCP are the current management entry points.
The Platform communications Web editor, its private presentation code and capability BFF routes
are retired. `/authoring/communications` and `/authoring/broadcasts` answer 404. This integration
adds no replacement editor, browser mutation path or visual approval gate.

## Identity and permission

An author needs a current confirmed Telegram link and Account permission `communications:manage`
(or an explicit `platform:admin` grant). Product Access, `materials:manage`, a Telegram username
and knowledge of a template ID confer no communications authority. Recipients need no Account.
The Platform facade derives the external author reference from the authenticated Account and its
exact confirmed link. An absent or ambiguous link fails closed; clients cannot provide their own actor.

`POST /integrations/telegram/v2/communications/authorize` authenticates the separate service bearer
credential and checks current Account/link/permission. Telegram subjects also match the configured
bot and exact provider identity. Allowed responses bind the checked Account reference; denied
responses expose no private link facts. Unavailable persistence returns 503, never an allow.

## HTTP and delegated MCP

`POST /communications` accepts the current provider management envelope with `actor` omitted.
The server validates unknown input, derives the author and rechecks current authorization for
reads, mutations and receipt replay. HTTP returns the owning result through the existing success
or Problem Details boundary; MCP uses the same application operation and error codes.

Delegated tools use `communications_<operation>` with dots replaced by underscores:

- `templates.list/read/save/testSend` and `intro.read/save`;
- `sequences.list/read/save/preview/publish/lifecycle/rollback`;
- `broadcasts.list/read/save/preview/launch/lifecycle`;
- `deliveries.read`, `delivery.resolve`, `statistics.read`, `entries.read`, `receipts.read`.

The generated [MCP surface](../../apps/backend/mcp/tool-surface.json) and current v2 schema define
exact tool names and closed input/output shapes. MCP fixes `contractVersion` and `operation`,
while preserving caller-supplied `operationId`, `expectedRevision` and `payload`. Retrying the same
operation preserves these values. A read, preview or save never implicitly publishes or sends.
An unavailable or malformed provider response remains a visible failure.

`templates.testSend` addresses only the confirmed author, with no caller-selected recipient.
`delivery.resolve` retains the part identity/revision and requires explicit duplicate-risk acceptance
for a retry of an unknown external result. Unknown sends are never automatically retried.
`receipts.read` authorizes the current actor and reads an original immutable operation receipt;
it never executes its old v1 command or grants another actor access to that receipt.

`POST /communications/templates/resolve` and `communications_templates_resolve` extract only a
UUID from a UUID reference or exact HTTPS `/communications/templates/<uuid>` path. They never
fetch the supplied host. Foreign templates remain `not_found`.

## Explicit intake opening notification

A waitlist broadcast names one immutable Product intake. Platform owns its active Account
memberships, sale state and purchase URL. Current author authorization, confirmed link and
`ProductWaitlists` determine eligibility; Telegram never substitutes all BotContacts or a chat
roster. The authenticated callback is
`POST /integrations/telegram/v2/communications/waitlist`.
The [Telegram waitlist contract](../../apps/telegram/docs/integrations/communications-v1.md#explicit-intake-opening-notification)
owns preview, launch, fresh checks before transport and closed-sale refusal.

## Configuration and owner bootstrap

Configure all four variables together in API and MCP. Missing configuration leaves the capability
unavailable; a partial or invalid configuration fails startup.

| Variable | Meaning |
|---|---|
| `TELEGRAM_COMMUNICATIONS_ENDPOINT` | Provider URL ending exactly in `/integrations/platform/v2/communications`, HTTPS or isolated loopback HTTP |
| `TELEGRAM_COMMUNICATIONS_SECRET` | Dedicated credential matching Telegram `PLATFORM_COMMUNICATIONS_SECRET` |
| `TELEGRAM_AUTHOR_AUTHORIZATION_SECRET` | Callback credential matching Telegram `PLATFORM_AUTHOR_AUTHORIZATION_SECRET` |
| `TELEGRAM_COMMUNICATIONS_BOT_IDENTITY` | Exact provider bot identity |

Telegram configures `PLATFORM_AUTHOR_AUTHORIZATION_URL` and `PLATFORM_AUTHOR_CONTENT_VALIDATION_URL`
for the corresponding Platform v2 `/authorize` and `/validate-content` paths. Requests reject redirects,
use bounded I/O and keep credentials out of URLs, browser clients and logs.
[Runtime configuration](../runbooks/runtime-configuration.md) owns source and env-file placement.
Existing explicit owner bootstrap can grant `communications:manage`; the default `materials:manage`
never implies that permission. No migration or sign-in automatically grants author rights.

## Funnel management UI

This anchor remains for existing links. The old editor is retired as described above. The following
public-target contract applies to Telegram and MCP publication and tracking.

Set `TELEGRAM_COMMUNICATIONS_PUBLIC_ORIGIN` to the canonical Platform origin, matching `WEB_BASE_URL`.
Publication and preview fail closed without it. `PublicContentTargets` validates published free
Materials and existing non-archived Product pages. Stable `/products/<slug>`, `/series/<slug>` and
`/guides/<slug>` human URLs identify the Product page regardless of protected programme content.
They do not select an old Series reader. Destination slugs, credentials, query/fragment, trailing
slash and encoded/extra segments follow the strict owning parser. Guide Material Format remains
separate from Product ownership.

`POST /integrations/telegram/v2/communications/validate-content` checks the service credential,
current author/link/permission and target eligibility without calling Telegram back under its
publication lock. Preview reports target errors. A new publish or rollback validates exact selected
message snapshots; an already committed receipt replays without a second publication.
The public Material Reader still checks current content access, so validation never grants access
or promises availability after unpublishing.

## Public tracking and durable event delivery

Public `/communications/visit` retains its opaque token and safe redirect contract. Material and
Product target parsing is shared with content validation. The Backend records allowed hits and a
Sales Funnel event outbox locally; that analytics context keeps its own name. Telegram provider
receives events through current v2 service transport, with stable event and operation IDs.
Committed events survive provider outages and deduplicate ambiguous delivery. A local persistence
failure remains visible and may lose the uncommitted hit; it is never reported as durable success.
Statistics distinguish live tracking backlog/unavailable from historical delay.

## Telegram sequential authoring timing (#310 / Telegram #43)

The Telegram author menu uses the same Sequence owner and expected revisions as HTTP/MCP.
Current callbacks are authorized and scoped to persisted sessions; stale menus cannot mutate a newer
screen. Saving does not publish. Participation and stable step IDs preserve completion, ordering,
unknown-effect barriers and future-message cancellation across publish, stop/resume and rollback.
The [Telegram timing contract](../../apps/telegram/docs/integrations/communications-v1.md#sequence-settings-in-the-bot-38-100)
and owning scheduler tests define relative versus `delayAnchor: "entry"` timing.

## Verification and transfer

The actual cross-application commands are Backend `conformance:communications` and Telegram
`conformance:communications-provider`, using separate loopback proof databases and simulated
external transport. They exercise real HTTP/MCP/provider authorization, publication, rollback,
tracking, waitlist checks and unknown-send handling. They do not send credentialed Telegram messages.
The [ordered transfer](../runbooks/domain-model-contract-transfer.md) and
[mixed restore](../runbooks/domain-model-restore.md) procedures preserve receipts and effect barriers
before incompatible contraction. Product checks and current WORKFLOW gates remain mandatory;
local proof does not authorize production enablement, messages or legal publication.
