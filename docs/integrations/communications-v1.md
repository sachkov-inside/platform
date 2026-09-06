# Platform communications integration

Platform #307 owns the Account-authorized HTTP/MCP consumer and Telegram author authorization.
The product authority is the accepted
[Workspace communications contract](https://github.com/sachkov-inside/workspace/blob/1553211220c44882dbacce7519dd50e35493090e/docs/specifications/telegram-communications-v1.md).
Telegram owns the physical schema and mutable communications state. Its pinned revision is recorded
in [the vendored snapshot](../../apps/backend/src/modules/communications/contracts/inside-communications-v1/snapshot.json).
Platform has no communications tables, second mutable definition store, or scheduler.

## Identity and permission

An author needs a confirmed Telegram link and the current Account permission `communications:manage`.
The owner confirmed the link prerequisite during #307 implementation on 2026-09-06. A recipient does
not need a Platform Account. `materials:manage`, Membership, a Telegram username, and knowledge of a
template ID confer no communications authority.

The current linking protocol passes a private `principalRef` as its external `accountRef`; it is not
`Account.id`. The facade resolves the authenticated Account to exactly one confirmed link and uses
that same stable reference that Telegram intake uses to own templates. An absent or ambiguous link
returns `link_required`; unavailable persistence fails closed. This preserves the existing exact
Logto `(issuer, subject)` identity, account establishment and independent Membership checks. The
merged sign-in delivery in [#299](https://github.com/sachkov-inside/platform/issues/299) writes the
same confirmed-link seam. Integration tests cover its Telegram-only Account and repeated sign-in
without implicit communications grants. Real Logto/provider end-to-end sign-in remains separately
verified by #299; #307 does not claim a new credentialed sign-in run.

`POST /integrations/telegram/v1/communications/authorize` implements the vendored
`authorizationRequest`/`authorizationResponse`. A separate service bearer credential authenticates
Telegram. Account subjects resolve the external reference to the current link and Account permission.
Telegram subjects additionally match the configured bot identity and exact stored provider identity.
Denied responses echo only contract version, request ID and `status: denied`; allowed responses echo
the checked external Account reference. No username lookup, raw Telegram ID lookup, role copied from
a JWT, or cached authorization is involved. A database failure returns HTTP 503, never an allow.

## HTTP and delegated MCP

`POST /communications` accepts the provider management envelope with `actor` removed. It validates
unknown input and derives the actor on the server. Every operation, including a repeated operation
ID, checks current permission and link state before calling Telegram. Responses use `{ ok: true,
value: <provider response> }`; failures are HTTP Problem Details. MCP uses the same application
operation and error codes in `{ ok: false, error: { code } }` with `isError: true`.

The delegated OAuth MCP endpoint registers `communications_<operation>` tools, replacing the dot
with an underscore, for these provider commands:

- `templates.read`, `templates.save`, `templates.testSend`;
- `intro.read`, `intro.save`;
- `funnels.list`, `funnels.read`, `funnels.save`, `funnels.preview`, `funnels.publish`,
  `funnels.lifecycle`, `funnels.rollback`;
- `broadcasts.read`, `broadcasts.save`, `broadcasts.launch`, `broadcasts.lifecycle`;
- `deliveries.read`, `delivery.resolve`, `statistics.read`.

Source definitions are read and saved with the funnel; the provider contract has no separate source
mutation. MCP input omits `contractVersion` and `operation`, which are fixed by each tool, and retains
caller-supplied `operationId`, `expectedRevision`, and `payload`. Preserve all three on a retry of the
same request. There is no extra UI approval gate for delegated publish or launch. Publication and
sending remain explicit operations; a read or preview never invokes test-send or launch.

`templates.testSend` has no caller-selected recipient: it addresses only the confirmed Telegram
author through the provider contract. `delivery.resolve` selects one part, retains the expected
revision, and requires `duplicateRiskAccepted: true` for explicit retry. An uncertain provider call
is never automatically retried by Platform. `provider_unavailable`, `provider_invalid_response`,
revision/operation conflicts and the provider's `not_implemented` are visible failures. A success
must have the expected operation's response shape and matching object identifiers.

`POST /communications/templates/resolve` and `communications_templates_resolve` accept `reference`
and `operationId`. A reference is a UUID or an HTTPS URL with the exact path
`/communications/templates/<uuid>`, without credentials, query or fragment. The URL host is untrusted
and is never fetched; only the extracted object ID reaches the authorized `templates.read` operation.
A foreign template remains `not_found`.

Eligibility and public tracking are separate Platform #310 work and cannot be called through these
delegated management tools. Provider commands still marked contract-only return `not_implemented`;
this facade does not deliver their scheduler or audience runtime. UI is #308/#309; #310 owns combined
provider/consumer and end-to-end acceptance.

## Configuration and owner bootstrap

Communications are unconfigured by default. Configure all four variables together in the API and MCP
process environments. Partial configuration fails startup:

| Variable | Meaning |
|---|---|
| `TELEGRAM_COMMUNICATIONS_ENDPOINT` | Provider URL ending exactly in `/integrations/platform/v1/communications`; HTTPS, or HTTP on loopback for an isolated local test |
| `TELEGRAM_COMMUNICATIONS_SECRET` | Existing provider `PLATFORM_INTEGRATION_SECRET`, kept only in private runtime configuration |
| `TELEGRAM_AUTHOR_AUTHORIZATION_SECRET` | Dedicated callback bearer secret matching the provider's `PLATFORM_AUTHOR_AUTHORIZATION_SECRET` |
| `TELEGRAM_COMMUNICATIONS_BOT_IDENTITY` | Exact configured provider bot identity; not the author's Telegram username |

Point the provider's `PLATFORM_AUTHOR_AUTHORIZATION_URL` at the Platform authorization endpoint above.
Connections reject redirects and time out after five seconds. Credentials are never placed in URLs,
client inputs, logs, fixtures, or shared repository state. The runtime source and container env-file
rules are in [runtime configuration](../runbooks/runtime-configuration.md).

Use the existing explicit release bootstrap with the owner's exact Logto identity and
`OWNER_PERMISSION=communications:manage`. The default remains `materials:manage`; selecting one
never grants the other. Grant creation and its audit event commit together and concurrent/repeated
bootstrap is idempotent. The audit includes the permission being granted. No migration, startup
hook or public route grants an author permission. Actual grants and production configuration remain
explicit owner operations; #307 does not configure a real author or send real messages.

## Verification

`pnpm --filter @inside/backend communications:generate` derives typed Zod codecs from the pinned
provider schema. `communications:check` verifies deterministic output and runs in backend guardrails.
The generator rejects schema vocabulary it cannot represent. The vendored positive/negative fixtures
run against both the generated codecs and the original JSON Schema. Public input rejection and
cross-module import negative fixtures protect the consumer seam without neighboring checkouts.

Real PostgreSQL tests cover independent grants, audit/idempotency, confirmed-link authorization,
revocation, denied ordinary/materials-only/unlinked Accounts, and signed-token HTTP/MCP parity.
A local HTTP contract stub checks the service credential and calls the real author authorization
endpoint. Vendored scenarios check consumer forwarding, repeated operation IDs, stale revisions,
foreign templates and permission revocation. Stub success for publish/launch proves consumer rights
and transport parity, not actual publication, audience selection or Telegram delivery.
