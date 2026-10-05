# Telegram Membership service for Sachkov Inside Platform

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-telegram-tribute-membership.md); текущие правила — [документы Platform](../../README.md).

> **Status update, 2026-08-30:** owner decisions superseded this note's OIDC linking proposal and
> its assumption that v1 has no bot update loop. Do not implement the OIDC-specific recommendations
> retained below as historical research. Normative cross-repository authority is the
> [Identity and Membership contract](../contracts/identity-membership-v1.md); application behavior
> belongs to the autonomous [`inside-telegram`](https://github.com/sachkov-inside/inside-telegram)
> repository.

The canonical-chat Membership Signal, Tribute exclusion, autonomous repository, normalized
evidence, bounded freshness and Platform authorization boundary remain valid. Telegram-specific
current API facts and credentialed proof gaps moved to the owning repository's
[`telegram-bot-membership-v1.md`](https://github.com/sachkov-inside/inside-telegram/blob/main/docs/research/telegram-bot-membership-v1.md).

**Historical status:** selected product/access contract and service stack direction for
[Workspace issue #41](https://github.com/sachkov-inside/workspace/issues/41) before the superseding
owner decisions above.

**Snapshot:** 2026-08-21

**Decision owner:** product owner; repository, product/access boundaries and bootstrap stack are
confirmed, while exact dependency versions, data-access library and deployment details below are
recommendations for later proof and ADRs in their owning application repositories

## Confirmed owner decisions

- Inside currently has one closed Telegram chat containing both content and discussion.
- Current membership in that chat is the canonical external signal for Platform Membership.
- Tribute currently manages admission and removal in Telegram, but Platform must not integrate
  with Tribute or depend on its subscription model.
- A dedicated branded Inside bot will link the email-authenticated Platform account to Telegram
  and read the linked user's membership in the configured chat.
- The bot is a separately deployed application in its own private repository, with its own
  Telegram business logic, storage, credentials and operational lifecycle.
- Bot v1 is limited to identity linking and read-only membership verification. It sends no
  messages, manages no members and processes no campaigns, but it is not a placeholder.
- The ContentAccess design in
  [`platform-content-access.md`](platform-content-access.md) confirms a five-minute maximum
  positive-evidence lifetime for new protected operations.
- The same bot identity may later support owner tooling, participant management, notifications and
  marketing, but those capabilities are not designed or implemented speculatively now.
- The service bootstrap stack is TypeScript, Node.js 24 LTS, NestJS with the Fastify adapter,
  grammY and PostgreSQL.

## Executive recommendation

Create a private `inside-telegram` repository containing one independently deployable Inside
Telegram service. Compose it as a modular NestJS application running on Fastify. Inside that
application, a deep **Telegram Membership module** hides Telegram OIDC, Bot API, status mapping,
freshness, conflicts and outages behind a small interface. It performs three jobs:

1. link an authenticated Platform Principal to a verified Telegram identity through Telegram
   OpenID Connect;
2. query the one configured closed chat with Bot API `getChatMember`;
3. return bounded normalized membership evidence that Platform turns into its application-owned
   access decision.

Register the dedicated bot as the Telegram OIDC client and add it as an administrator of the
closed chat with all optional mutation rights disabled. Telegram states that `getChatMember` is
guaranteed to work for other users when the bot is an administrator
([Bot API `getChatMember`](https://core.telegram.org/bots/api#getchatmember)). Bot v1 does not need
commands, polling or a Telegram update webhook. Platform calls the service over an authenticated
internal interface; only the service calls Telegram OIDC and Bot API.

The confirmed Platform brief requires one closed-access level, email authentication, a linked
Telegram account, and access based on an external Membership signal. The Platform does not take
payment or manage subscription terms. Tribute currently performs payment and Telegram-roster
operations but is replaceable and outside the integration contract. The closed-chat roster is the
external Membership authority, while Platform remains authoritative for access to Platform content
([Platform v1 brief](https://github.com/sachkov-inside/platform/blob/main/docs/product/platform-mvp-brief.md)).

Use a **five-minute positive evidence lifetime** as the confirmed v1 bound. Protected requests
use the local entitlement while it is fresh. When stale, one request refreshes it through
`getChatMember`; `member`, `creator`, `administrator`, or `restricted` with `is_member=true` grants
another bounded interval. `left`, `kicked`, or `restricted` with `is_member=false` denies
immediately. Therefore Platform stops granting new protected access within at most five minutes of
removal from Telegram, without making every content request synchronously depend on Telegram.
Already delivered bytes cannot be recalled; derived playback and download credentials must obey
the same bound described below.

This makes Tribute replaceable. Tribute, another provider or the owner may change the Telegram
roster; Platform observes only the resulting membership. Existing participants need no provider
backfill: each is verified on demand when linking or first using Platform.

## Selected authority contract

```text
Email authentication
        |
        v
Platform Principal
        |
        | authenticated internal interface
        v
Inside Telegram service
        |
        | Telegram OIDC through the Inside bot
        v
Verified ExternalIdentity(telegram_user_id)
        |
        | getChatMember(fixed_inside_chat_id, telegram_user_id)
        v
Fresh TelegramMembershipObservation
        |
        | bounded normalized decision
        v
Platform MembershipEntitlement(valid_until <= observation.valid_until)
        |
        v
Platform authorization
```

Authority is deliberately split:

- the email IdP proves the Platform Principal;
- the Telegram service proves control of one Telegram account through OIDC;
- the Telegram service observes whether that account is currently in the configured chat;
- Platform owns and evaluates the bounded entitlement to closed Platform content.

Tribute is outside this chain. A valid payment, Tribute event, receipt, Telegram username, invite
link or Platform login session does not grant Membership by itself.

## User experience

### Existing member

1. The user signs in to Platform by email.
2. Platform shows “Link Telegram”. The user does not need to send `/start` to the bot.
3. Platform creates a short-lived link session in the Telegram service and redirects the browser.
4. The Telegram service completes Authorization Code Flow, verifies the ID token and attaches the
   Telegram identity to the opaque Platform Principal reference from that session.
5. The Telegram service immediately calls `getChatMember` for the fixed Inside chat.
6. A current member receives access; a non-member sees a precise “Telegram linked, Membership not
   found” state and a rate-limited “Check again” action.

No migration or full Telegram member export is required. The first check discovers every existing
participant individually.

### Removal and return

- Tribute or an administrator removes the user from the Telegram chat.
- Platform keeps access only until the last successful five-minute observation expires.
- The next protected request refreshes membership, observes `left`/`kicked`, and denies.
- The email account, Telegram link, reading history and other account data remain intact.
- If the user later rejoins, “Check again” or the next stale check restores access without a new
  Platform account or Telegram relink.

This deliberately equates Telegram roster management with Membership authorization. A manually
added Telegram participant gets Platform access; a paid participant accidentally removed or who
leaves voluntarily loses it.

## Telegram identity proof

Telegram's current Login implementation supports standard OIDC Authorization Code Flow, PKCE,
discovery and JWKS. Telegram requires a bot to represent the application and BotFather supplies
the OIDC client ID and secret
([Telegram Login](https://core.telegram.org/bots/telegram-login)).

### Live read-only verification

The following public requests were run on 2026-08-21 without owner credentials or external
writes:

```bash
curl -fsSL https://oauth.telegram.org/.well-known/openid-configuration | jq .
curl -fsSL https://oauth.telegram.org/.well-known/jwks.json \
  | jq '{keys: [.keys[] | {kty,kid,use,alg,crv}]}'
```

Discovery returned HTTP 200 and advertises only authorization-code response/grant, `plain` and
`S256` PKCE, public subjects, and `RS256`, `ES256`, `EdDSA`, `ES256K` ID-token algorithms. The live
JWKS returned a key for each advertised algorithm. The metadata advertises no UserInfo endpoint;
its `claims_supported` omits both Telegram's documented profile `id` and OIDC `nonce`. Therefore
the credentialed proof must observe both actual claims and must not assume that a requested
`nonce` is echoed.

### Protocol rules

- Start linking only from an authenticated Platform session; require recent email
  re-authentication because link replacement can transfer paid access.
- Use the discovery issuer `https://oauth.telegram.org`, authorization code response, exact
  registered redirect URI and PKCE `S256`.
- Request only `openid profile`. Do not request `phone` or `telegram:bot_access` in v1.
- Bind high-entropy `state`, PKCE verifier and the requested `nonce` to the current
  Principal/session in a short-lived, single-use server transaction.
- Exchange the code server-side using the OIDC client secret.
- Validate a configured signing algorithm (`RS256` initially), signature against
  [Telegram JWKS](https://oauth.telegram.org/.well-known/jwks.json), exact issuer, audience,
  expiry, issued-at and subject. Validate an echoed `nonce` exactly; if Telegram does not echo it,
  the Telegram service ADR must explicitly document the observed behavior and rely on the bound
  single-use `state` plus PKCE rather than pretending nonce validation occurred.
- Treat `(iss, sub)` as the durable external identity. Store the separate profile `id` as the
  exact Telegram user ID used by Bot API.
- Store Telegram IDs as decimal strings at JSON seams and an exact representation with at least a
  signed 64-bit range internally. Telegram says these IDs may exceed 32 bits and have at most 52
  significant bits ([Bot API IDs](https://core.telegram.org/api/bots/ids)).
- Never link or recover by username, display name, phone, picture or email similarity.

The credentialed proof must still record whether Telegram echoes the requested `nonce` and show
that the OIDC profile `id` is accepted as the same user's Bot API `user_id`. Telegram documents
both IDs as Telegram user IDs but does not explicitly state the cross-interface equality, and its
OIDC example keeps `sub` and `id` separate.

### Link and relink invariants

- Unique historical `(provider, issuer, subject)` binding; unlink keeps its original Principal.
- Unique historical `(provider, telegram_user_id)` binding; unlink never frees the ID for a
  different Principal.
- At most one active Telegram identity per Principal in v1.
- Linking the same identity to the same Principal is idempotent.
- An identity attached elsewhere enters conflict; never auto-merge or transfer it.
- A tombstoned identity may be reactivated only for its original Principal after fresh Telegram
  proof. Moving it to another Principal requires audited owner recovery and an explicit transfer
  record; deleting or bypassing the tombstone is forbidden.
- V1 has no casual self-service replace action. Replacement requires recent primary re-auth,
  proof of the current Telegram identity or owner recovery, explicit confirmation and audit.
- Removing Membership never unlinks Telegram. Unlinking never deletes membership observations or
  account history.

## Recommended cross-repository module shape

The external seam belongs between Platform's authorization decision and the Telegram service's
normalized membership result, not at raw Telegram HTTP methods. Platform callers must not know
Telegram chat statuses, OIDC claim quirks, service storage or provider errors.

### External interface

Illustrative service module interface, independent of its HTTP adapter:

```text
TelegramMembership
  beginLink(platformPrincipalRef, returnTo) -> LinkRedirect
  completeOidc(callback) -> LinkOutcome
  resolveMembership(platformPrincipalRef, forceRefresh = false) -> MembershipDecision

MembershipDecision
  member | not_member | conflict | unavailable
  reasonCode
  checkedAt
  validUntil
  telegramIdentityRef
  evidenceRef
  evidenceVersion
```

Interface invariants:

- `beginLink` never accepts a Telegram user ID; an authenticated service call binds one opaque,
  non-email Platform Principal reference to the transaction.
- `returnTo` is an allowlisted local destination, never an arbitrary callback URL.
- `completeOidc` consumes one transaction once, persists the verified identity and immediately
  resolves membership.
- `resolveMembership` returns normalized bounded evidence, not raw `ChatMember` data and not a
  permanent Platform role.
- Normal authorization refreshes only when evidence is stale. The user-facing refresh action sets
  `forceRefresh=true` and is rate-limited.
- `member` always has a finite `validUntil`; there is no permanent boolean member flag.
- A `member` result always carries opaque `telegramIdentityRef`, `evidenceRef` and monotonic
  `evidenceVersion`; Platform persists them for audit without dereferencing the service database.
- Identity conflict, confirmed non-membership and expired evidence fail closed with distinct
  reason codes.

The service exposes this behavior over a versioned authenticated internal HTTP interface. Platform
owns a `TelegramMembership` port at that remote-owned seam, with an HTTP adapter in production and
an in-memory adapter in Platform tests. The transport contract contains no bot token, username,
raw OIDC token or raw Telegram status.

### Internal implementation and seams

```text
TelegramMembership implementation
  |- link transaction rules
  |- ID-token validation and identity invariants
  |- chat-member status mapping
  |- observation freshness and single-flight refresh
  |- normalized observation and audit
  |
  |- Telegram OIDC adapter ------ true external dependency
  |- Telegram Bot API adapter --- true external dependency
  `- persistence/clock ---------- internal seams for tests
```

Telegram is a true external dependency, so the implementation owns narrow internal ports and uses
production HTTP plus mock adapters in tests. These ports are not exposed through the module's
external interface. Service tests exercise `beginLink`, `completeOidc` and `resolveMembership`;
cross-repository contract tests verify Platform's HTTP adapter against the service schema.

Do not create generic bot, provider or campaign abstractions now. One production and one mock
adapter justify the external seams; hypothetical future providers do not.

## Minimal Telegram service v1

### Included

- one branded bot created and owned through BotFather;
- one private `sachkov-inside/inside-telegram` repository and independent deployable;
- one service-owned PostgreSQL database and migrations;
- an authenticated versioned internal interface for Platform plus the public OIDC callback;
- BotFather allowed origins/redirect URIs and OIDC client credentials;
- bot added as administrator to the one configured Inside chat;
- separate OIDC client secret and Bot API token in the Telegram service secret store;
- OIDC linking after email authentication;
- server-side `getChatMember` checks for a fixed numeric chat ID;
- five-minute bounded membership observation and rate-limited refresh;
- link, membership-check, denial, conflict and provider-error audit/metrics.

### Explicitly excluded

- `/start` or any other bot commands;
- direct messages, notification consent and `telegram:bot_access` scope;
- bot webhook, long polling and `chat_member` update processing;
- approving joins, creating invite links, banning/removing members or changing permissions;
- content posting, moderation, owner dashboards, scheduled notifications or marketing;
- Tribute API keys, webhooks, subscribers or subscription records.

The service is independently deployed even though it has no inbound Telegram update loop in v1.
Do not add a queue, Redis, generic campaign engine or empty worker merely to anticipate future
messaging. Add a worker entrypoint in the same repository when the first durable asynchronous bot
workflow is approved.

## Selected service stack direction

Use **TypeScript on Node.js 24 LTS, NestJS with the Fastify adapter, grammY and PostgreSQL**. NestJS
is the application composition and runtime framework; Fastify serves the public OIDC callback and
authenticated internal HTTP interface; grammY is the Telegram update/API adapter; PostgreSQL owns
the service state. The already researched **Kysely + `pg`** option remains a bounded data-access
recommendation, not part of this owner decision. Pin exact dependency versions in the bootstrap
repository and upgrade them through isolated contract-test PRs.

| Concern | Target | Why |
|---|---|---|
| Runtime | Node.js 24 LTS | Node recommends production applications use an LTS line; v24 is the current LTS on this snapshot ([Node releases](https://nodejs.org/en/about/previous-releases)). |
| Language | TypeScript with strict compiler settings | One typed language fits Telegram adapters, internal HTTP contracts and a future web admin without introducing a Python-only operating path. |
| Telegram framework | grammY 1.x | Current TypeScript-first framework with Bot API 10.2 support and official router, conversations, menus, runner, retry, throttling and chat-member plugins. |
| Application framework | NestJS | Provides explicit modules, dependency injection and test utilities for the planned long-lived bot service; queues and scheduling remain optional capabilities, not bootstrap dependencies ([modules](https://docs.nestjs.com/modules), [testing](https://docs.nestjs.com/fundamentals/testing), [queues](https://docs.nestjs.com/techniques/queues), [task scheduling](https://docs.nestjs.com/techniques/task-scheduling)). |
| HTTP adapter | Fastify 5.x | Nest officially supports Fastify through `FastifyAdapter`; Fastify supplies schema validation/serialization, TypeScript support and an LTS policy ([Nest performance/Fastify](https://docs.nestjs.com/techniques/performance), [Fastify TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/), [validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [LTS](https://fastify.dev/docs/latest/Reference/LTS/)). |
| Durable store | PostgreSQL | Exact identity uniqueness, single-use link transactions, observation history and audit need transactions and constraints. |
| Data access | Kysely + `pg`, subject to its existing bounded spike | Keeps SQL, transactions and migrations explicit; reuse the decision evidence in [`platform-postgresql-data-access.md`](platform-postgresql-data-access.md) rather than choose a second data model casually. |
| Test shape | module-interface tests, Nest module tests, HTTP contract tests and credentialed Telegram smoke tests | NestJS composes the application and grammY is an adapter; business tests must not depend on framework `Context` objects. |

Do not choose a current Node release such as Node 26 for production before it becomes LTS. NestJS
is selected because the concrete roadmap includes owner tooling, notifications, marketing and a
possible admin surface, not because v1 needs many layers. Keep Nest decorators, controllers and
providers at composition/adapter seams; domain commands, outcomes and policies remain plain
TypeScript. Do not install BullMQ, Redis, scheduling or a campaign engine until the first approved
asynchronous workflow needs them.

### Telegram framework comparison

Snapshot checked against official repositories and documentation on 2026-08-21:

| Candidate | Current evidence | Decision |
|---|---|---|
| **grammY** | v1.45.1 was released 2026-07-17; v1.45.0 added current Bot API 10.2. Official plugins cover conversations, menus, router, concurrency runner, retries, throttling, rate limiting and chat members ([Bot API changelog](https://core.telegram.org/bots/api-changelog#july-14-2026), [releases](https://github.com/grammyjs/grammY/releases), [plugins](https://grammy.dev/plugins/guide), [scaling](https://grammy.dev/advanced/scaling)). | **Target.** Best fit for TypeScript, current Bot API coverage and future bot interactions. |
| **Telegraf** | Latest v4.16.3 is from 2024 and its official release notes describe Bot API 7.1 support, v4 support ending in February 2025 and a planned v5 that is still not released ([releases](https://github.com/telegraf/telegraf/releases)). | Reject for a new long-lived bot despite its large installed base. The maintenance/version transition is the dominant risk. |
| **aiogram** | Active async Python framework; v3.30.0 added Bot API 10.2 on 2026-07-17 and includes routers, FSM, middleware, webhook integration and generated Bot API types ([repository](https://github.com/aiogram/aiogram), [releases](https://github.com/aiogram/aiogram/releases)). | Credible fallback if Inside deliberately selects Python for the whole Telegram application. No current requirement justifies the second language. |
| **python-telegram-bot** | Mature async Python project; v22.8 was released 2026-06-12 with Bot API 10.0, webhooks, polling, persistence and a large community. Its own docs warn that several update, conversation and persistence surfaces are not thread-safe ([release](https://github.com/python-telegram-bot/python-telegram-bot/releases/tag/v22.8), [repository](https://github.com/python-telegram-bot/python-telegram-bot)). | Mature but not the target; behind current Bot API 10.2, weaker fit than aiogram for a new typed async service and still introduces Python operations. |

The choice is not based on GitHub stars. Telegraf and python-telegram-bot are larger projects, but
Bot API currency, an active release line and fit with the selected service language matter more
for a new repository.

### grammY risk boundary

grammY has one material gap: it does not yet ship an official production-grade handler testing
package; an official adoption proposal remained open in May 2026
([testing proposal](https://github.com/grammyjs/grammY/issues/903)). Keep this risk bounded:

- business workflows accept plain commands and return plain outcomes behind the module interface;
- grammY `Context`, middleware and sessions remain in Telegram adapters;
- tests inject Bot API/OIDC adapters and exercise module behavior without a bot token;
- a framework replacement rewrites adapters, not identity, membership or campaign rules.

Runner, conversations and webhook support are evidence that the framework can grow beyond v1, not
selected workflow architecture or current proof scope. The first inbound command, admin or
messaging workflow must separately design and prove ordering, idempotency, persistence, webhook
delivery and side-effect safety before adding those packages or entrypoints.

### Repository and deployment shape

Start as one repository and one modular application, not a fleet of microservices:

```text
inside-telegram/
  src/membership/    deep linking and membership rules; plain TypeScript core
  src/telegram/      grammY, Bot API and OIDC adapters
  src/http/          Nest controllers for internal interface and OIDC callback
  src/persistence/   PostgreSQL adapters and migrations
  src/runtime/       Nest composition, configuration, health and telemetry
```

V1 deploys one stateless NestJS/Fastify application process plus PostgreSQL. Nest modules compose
the real capability boundaries above; do not create empty `admin`, `campaign` or `notification`
modules. The repository owns its build, tests, migrations, secrets, health checks and deployment.
A future bot-update worker or admin UI may become another entrypoint in this repository, but no
empty package or deployment is created until its first use case exists. Platform never imports
source or generated code from a sibling checkout; it consumes a versioned schema over the
authenticated internal interface.

## Bot ownership and chat rights

Use a dedicated Inside bot rather than `@Tribute` or an unrelated existing bot:

- Inside controls its OIDC client and Bot API credentials;
- the user sees a coherent Inside name/avatar during linking;
- future capabilities can use the same public bot identity without changing linked accounts;
- Tribute can disappear without changing Platform identity or authorization contracts.

Add the bot to the canonical closed chat as an administrator because Telegram guarantees
`getChatMember` for arbitrary users only in that role. Disable every optional right to post,
delete, invite, ban, pin, edit or manage topics. Confirm the minimal permission set with a real
member/non-member check before launch.

Keep credentials separate even though they belong to one bot:

- OIDC client secret is used only for server-side code exchange;
- Bot API token is used only by the membership reader in v1;
- neither secret reaches browser JavaScript, logs, committed files or analytics;
- token rotation and bot removal from the chat are operational incidents with alerts.

The configured numeric chat ID is trusted configuration. Never accept a chat ID from the browser
or check membership in an arbitrary chat requested by a user.

## Membership status mapping

Telegram defines six `ChatMember` variants
([Bot API types](https://core.telegram.org/bots/api#chatmember)). Map them once inside the module:

| Telegram result | Platform observation | Access |
|---|---|---|
| `creator` | `member` | Grant. |
| `administrator` | `member` | Grant. |
| `member` | `member` | Grant; if optional `until_date` is present, do not extend evidence beyond it. |
| `restricted` with `is_member=true` | `member` | Grant; restrictions concern chat actions, not presence. |
| `restricted` with `is_member=false` | `not_member` | Deny. |
| `left` | `not_member` | Deny. |
| `kicked` | `not_member` | Deny. |
| transport/auth/parse error | `unavailable` | Use still-fresh prior evidence only; otherwise deny without rewriting it as confirmed non-membership. |

Preserve the raw status in bounded diagnostic evidence, but callers see only the normalized
decision and reason.

## Cross-repository data ownership

The Telegram service records observed Telegram facts; Platform records its application
entitlement. There are no cross-database foreign keys or shared tables.

### `telegram_link_transaction`

Telegram service-owned short-lived, single-use state for opaque Platform Principal reference,
state/nonce hashes, a recoverable high-entropy PKCE `code_verifier` protected at rest, its derived
challenge, allowlisted return URL, expiry and consumption. The callback needs the original
verifier for token exchange; it is never logged and is deleted after consumption/expiry. The
transaction contains no entitlement.

### `external_identity`

| Field | Purpose |
|---|---|
| `id`, `platform_principal_ref` | Service identity and its opaque Platform owner reference. |
| `provider`, `issuer`, `subject` | `telegram`, exact issuer and opaque OIDC `sub`; historically unique across Principals. |
| `telegram_user_id` | Verified profile `id`, historically unique across Principals. |
| `status` | `active`, `unlinked`, `conflict`, `recovery_hold`. |
| `verified_at`, `unlinked_at`, `last_seen_at` | Lifecycle and audit timestamps. |
| display snapshots | Optional support display only; never keys. |

### `telegram_membership_observation`

| Field | Purpose |
|---|---|
| `id`, `evidence_version` | Opaque evidence reference and monotonic per-identity projection version returned to Platform. |
| `external_identity_id`, `chat_id` | Exact identity and configured authority chat. |
| `state` | `member`, `not_member`, `unavailable`. |
| `raw_status`, `raw_is_member` | Diagnostic Telegram result without leaking it to callers. |
| `checked_at`, `valid_until` | Evidence time and bounded freshness. |
| `source` | `link`, `protected_request`, `user_refresh`. |
| `provider_request_id`, `error_code` | Correlation and safe operational diagnosis. |

Keep observation history or an audit event for grant/revoke transitions; a current projection may
be stored separately inside the service for fast resolution.

### Platform-owned `membership_entitlement`

| Field | Purpose |
|---|---|
| `principal_id`, `entitlement_key` | One `inside_membership` authorization level in v1. |
| `state` | `granted`, `denied`, `conflict`. |
| `valid_until` | Never later than the supporting membership observation. |
| `telegram_identity_ref`, `evidence_ref`, `evidence_version` | Opaque service evidence returned together; not foreign keys into the service database. |
| `evaluated_at`, `reason_code`, `policy_version` | Deterministic Platform policy and audit. |

This is a rebuildable projection, not an IdP role or long-lived token claim. Every protected
request rejects a granted entitlement whose `valid_until` has passed and asks the Telegram
service to refresh it.

### Tribute candidate model: evaluated and not selected

The original candidate included `webhook_inbox` plus `external_subscription`, joined through
`telegram_user_id` into `membership_entitlement`. It is not part of selected v1:

| Candidate | Decision |
|---|---|
| `external_identity` | Retained in the Telegram service because linking is still required. |
| Tribute `webhook_inbox` | Rejected for v1; neither application receives Tribute events. |
| `external_subscription` | Rejected for v1; Telegram membership, not payment/subscription state, is authoritative. |
| `membership_entitlement` | Retained in Platform, now derived from a bounded service observation. |

## State machine

Identity and membership evidence are independent; removing someone from the chat must not destroy
their linked Platform account.

```text
IDENTITY

NEVER_LINKED -- verified OIDC + uniqueness --> LINKED
LINKED -- explicit secure unlink ----------> UNLINKED_TOMBSTONE
UNLINKED_TOMBSTONE -- same Principal + fresh proof --> LINKED
any -- identity owned by another Principal -> CONFLICT / audited owner recovery only

MEMBERSHIP OBSERVATION

UNKNOWN -- getChatMember(member-like) ---> MEMBER(until T)
UNKNOWN -- getChatMember(left/kicked) ----> NOT_MEMBER
MEMBER  -- fresh cache read --------------> MEMBER(same T)
MEMBER  -- stale + member-like -----------> MEMBER(new T)
MEMBER  -- stale + left/kicked -----------> NOT_MEMBER
NOT_MEMBER -- force/stale + member-like ---> MEMBER(until T)
any -- Telegram unavailable --------------> prior fresh evidence or UNAVAILABLE

ENTITLEMENT

LINKED + MEMBER + now < T ----------------> GRANTED(until T)
not linked / NOT_MEMBER / expired --------> DENIED
identity conflict ------------------------> CONFLICT
```

Transitions are idempotent. Concurrent stale requests use a single-flight refresh or row lock so
one Principal does not generate a Bot API request storm. Provider errors never masquerade as a
confirmed `not_member` result.

## Idempotency contract

- A link transaction is single-use. Replaying its callback fails before code exchange or state
  mutation.
- If the same verified Telegram identity is already attached to the same Principal after a client
  timeout, completing the application operation again returns the existing link rather than a
  duplicate row.
- Repeating `getChatMember` with the same result creates no new entitlement transition; it only
  refreshes evidence time through one serialized update.
- Concurrent stale protected requests share one in-flight provider check or serialize on the
  current observation. They cannot extend access independently.
- A newer confirmed observation replaces the current projection; late completion of an older
  request cannot overwrite it. Compare local request start/completion/version, not Telegram wall
  clock fields that the method does not provide.
- Audit events use application-generated IDs and transition/version uniqueness. V1 has no inbound
  bot or Tribute delivery to deduplicate.

## Freshness, revocation and availability

Recommended v1 policy:

- positive observation/entitlement TTL: **five minutes**;
- confirmed negative result: deny immediately; cache for 30 seconds to limit repeated clicks;
- force refresh: rate-limit per Principal and IP, suggested once per 10 seconds with normal abuse
  limits;
- check on successful linking, new login/session, user refresh and the first protected request
  after evidence expires;
- Telegram unavailable: honor only an already-fresh positive observation, with no extra grace;
- after five minutes without a successful recheck, protected content fails closed while public
  content/account data remain available;
- session cookies and access tokens must not carry a Membership grant beyond `validUntil`;
- every derived protected artifact, including Kinescope playback authorization and private-file
  URLs, expires no later than the supporting entitlement; CDN/browser cache policy must not make
  that artifact reusable after the bound.

This policy gives a measurable maximum of five minutes before Platform stops granting new access.
It cannot revoke bytes already downloaded, a page already rendered in a browser, a screen capture
or a playback segment already delivered to the device. If the owner later accepts a longer delay
for availability, coordinated Telegram service and Platform ADRs may change the policy value
without changing the product authority contract.

## Failure and error table

| Failure | Detection | Access behavior | Recovery |
|---|---|---|---|
| Email session missing/stale | Link-start guard | No link. | Re-authenticate by email. |
| Telegram consent denied/expired | OIDC callback | No link. | Start a new link transaction. |
| State/PKCE/nonce mismatch or replay | Single-use validation | No link; security audit. | Discard transaction and investigate repetition. |
| Bad token signature/issuer/audience/algorithm/time | Strict ID-token validation | No link. | New flow; provider/security investigation. |
| Missing/invalid profile `id` | Claim/range validation | No link/access. | Provider support; never fall back to username. |
| Identity already linked elsewhere | Unique constraint | Conflict; no transfer. | Audited recovery. |
| Principal already linked to another Telegram account | Unique constraint | Keep existing link. | Explicit secure replacement. |
| Platform-to-service authentication fails | Internal interface authentication | No link or refresh; fresh prior evidence only. | Restore/rotate machine credential and audit calls. |
| Telegram service is unavailable | Timeout/circuit/health signal | Fresh prior grant only; otherwise deny as unavailable. | Backoff, restore service and recheck. |
| Bot is not administrator | Staging/health check or Bot API error | No new grant; fresh prior evidence only. | Restore minimal admin role and recheck. |
| Wrong configured chat ID | Startup/proof check | No access or wrong roster: launch blocker. | Correct immutable environment configuration. |
| User is current member | `getChatMember` member-like result | Grant for bounded TTL. | Normal refresh. |
| User left/was removed/banned | `left`, `kicked`, or not-member restriction | Stop new grants on observation, at most TTL after removal; already delivered bytes remain. | Rejoin/re-add, then refresh. |
| Telegram network/rate failure | Transport/error response | Fresh prior grant only; otherwise deny as unavailable. | Backoff, single-flight and retry. |
| Bot token revoked/compromised | Auth errors/incident | No stale extension; fail closed after TTL. | Rotate token, audit and recheck. |
| OIDC secret rotated incorrectly | Token exchange failure | No new links; existing bounded checks continue via Bot token. | Correct/rotate client secret. |
| Concurrent refresh storm | Metrics/lock contention | One external request; others reuse result/wait. | Single-flight/lock and rate limits. |
| User was manually added without payment | Valid member result | Grant: this is intentional authority semantics. | Remove from Telegram if access is not intended. |
| Paid user leaves accidentally | Valid `left` result | Deny. | Rejoin through current Telegram access process. |

## Why direct Tribute integration is rejected

Tribute remains operationally useful because it currently adds and removes participants from the
closed chat. Platform does not need to understand how or why it does so.

The primary-source investigation found only `new_subscription`, `renewed_subscription` and
`cancelled_subscription` webhooks, no stable event ID, no documented terminal expiry/refund/
failed-payment lifecycle, and no supported public member reconciliation contract. A
`/subscribers` operation exists in the OpenAPI document but is marked `x-internal: true`
([Tribute webhooks](https://wiki.tribute.tg/for-content-creators/api-documentation/webhooks.md),
[Tribute OpenAPI](https://tribute.tg/api/v1/openapi/en)).

| Investigated Tribute concern | Primary-source result |
|---|---|
| Signature | `trbt-signature` is HMAC-SHA256 over the request body using the API key, but encoding, prefix, replay window and rotation are undocumented. |
| Events | Only new, renewed and cancelled subscription events are documented; they carry Telegram ID and `expires_at`, but no stable event/delivery ID. |
| Ordering and duplicates | No ordering or at-least-once guarantee is stated. Current docs require idempotency but do not provide a canonical idempotency key. |
| Retry | The canonical webhook page lists 5m, 15m, 30m, 1h, 2h, 4h, 8h, 8h, while another official [integration guide](https://wiki.tribute.tg/for-content-creators/info-products-and-content/api-integration.md) still lists 5m, 15m, 30m, 1h, 10h. |
| Cancellation and expiry | It is unclear whether cancellation means auto-renew off or immediate loss, whether `expires_at` includes the documented failed-payment grace, and what marks final expiry/refund/resume. |
| Backfill/reconciliation | The supported [`/subscriptions`](https://wiki.tribute.tg/for-content-creators/api-documentation/subscriptions.md) operation lists products, not members. `/subscribers` is internal and has no supported pagination/consistency/rate contract. |

These findings explain the rejected design; Platform no longer needs to resolve them before
launch. The current Telegram roster is reconciled per user through the supported Bot API method.

Those gaps no longer block Platform. If Tribute is replaced, the replacement only needs to manage
the same Telegram roster—or the owner can do so manually. Platform's interface and the Telegram
service's linked identities remain unchanged.

The trade-off is explicit: Platform authorizes actual Telegram presence, not a paid-through date.
Removal lag in Tribute becomes removal lag from Telegram plus at most the Platform TTL. Platform
cannot distinguish payment cancellation, manual gift, complimentary access or administrative
mistake, and does not try.

The dedicated bot identity and service repository leave room for later capabilities, but their
workflows, permissions, consent, interfaces and any additional deployables are outside this v1
design.

## Bounded credentialed proof

The remaining proof needs owner-controlled BotFather credentials and temporary minimal admin
access in the real or a representative closed chat. It requires no Tribute key or test payment.

| Timebox | Proof | Required evidence |
|---|---|---|
| 0.5 day | Bot/OIDC setup | Branded bot, exact redirect, two code flows, strict token validation, stable `sub` and profile `id`, observed requested-`nonce` behavior. |
| 0.25 day | Existing member | OIDC `id` accepted as Bot API user ID; `getChatMember` returns a member-like status and Platform grants. |
| 0.25 day | Non-member/removal | Non-member is denied; remove the fixture and prove no new page/API/playback/download grant later than five minutes. |
| 0.25 day | Rejoin/re-add | Re-add the same Telegram account; refresh restores access without relink. |
| 0.25 day | Security cases | Replay, wrong audience, duplicate identity, attempted relink and user-supplied chat ID are rejected. |
| 0.25 day | Availability | Bot loses admin/token/network temporarily; fresh evidence expires and protected access fails closed as designed. |
| 0.5 day | Service contract | A NestJS module composed on Fastify and an in-memory test adapter pass the same contract; service timeout and credential rotation fail closed. Domain tests do not require Nest or grammY context objects. |

Stop after evidence plus repository bootstrap and ADR proposals in the owning repositories. Do not
add commands, update processing or messaging to the proof.

## Go/no-go

The recommended architecture may proceed beyond bounded proof only when all of these pass:

1. The owner approves the bot name/avatar and the bot is owned through a recoverable Inside
   operator account.
2. Telegram OIDC works through a Platform-created service link session without exposing tokens to
   browser storage or relying on a UserInfo endpoint; requested-`nonce` behavior is observed and
   the actual validation policy is recorded in the Telegram service ADR.
3. The OIDC profile `id` works as the exact Bot API `user_id` for the same fixture.
4. With minimal admin permissions, the bot can distinguish an existing member, non-member,
   removed/banned member and re-added member in the configured chat.
5. After removal, Platform issues no new page, API, playback or download access beyond the accepted
   TTL even while the email session remains active; re-add restores access without relink.
6. Bot API outage, lost admin role and token rotation fail closed after the last bounded evidence
   and produce actionable health signals.
7. Identity uniqueness and recovery tests prevent silent link transfer or account merge.
8. The versioned internal interface authenticates Platform, preserves the five-minute evidence
   bound and can be tested through HTTP and in-memory adapters without sharing a database.
9. The NestJS bootstrap runs on Fastify, and replacement test adapters exercise the Membership
   module without Telegram credentials or framework context leaking into business rules.

No-go means keep closed Platform access disabled while email accounts/public content can continue;
do not fall back to username, screenshot, payment receipt or an unbounded manual grant.

## Remaining owner decisions

1. Choose the public bot username, display name/avatar and owner/recovery account.
2. Confirm that v1 has no self-service Telegram replacement; exceptional recovery goes through an
   audited owner procedure.
3. Confirm `inside-telegram` as the repository name before bootstrap.

Everything else needed for the first version is selected or recommended for proof: **one dedicated
Inside bot and service repository, TypeScript/Node.js 24 LTS, NestJS with the Fastify adapter,
grammY, PostgreSQL, one configured closed chat, Telegram OIDC linking, read-only `getChatMember`,
bounded Platform entitlement, no Tribute integration and no bot messaging/management workflow in
v1**.
