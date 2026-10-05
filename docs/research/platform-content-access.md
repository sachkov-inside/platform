# ContentAccess for Sachkov Inside Platform v1

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-content-access.md); текущие правила — [документы Platform](../../README.md).

**Status:** owner-confirmed cross-repository design for
[Workspace issue #54](https://github.com/sachkov-inside/workspace/issues/54)

**Snapshot:** 2026-08-21

**Decision owner:** product owner; this report is an input to the Platform specification and later
application proofs/ADRs, not an application ADR or implementation plan

## Decision

Platform owns one deep `ContentAccess` module. Every delivery path for a material body, protected
asset, download, preview or video asks its small interface for an `AccessDecision`; routes,
renderers, MCP tools, signed-URL endpoints and Kinescope adapters do not reproduce Membership
rules.

The module is deliberately provider-neutral:

- authentication supplies a stable Platform Principal reference, never an IdP role that grants
  Membership;
- the separate `inside-telegram` application supplies bounded Membership evidence, never raw
  Telegram or Tribute data;
- Platform derives and stores a bounded Membership entitlement and makes the final content
  decision;
- Kinescope and object storage receive short-lived delivery credentials derived from an allowed
  decision, but never become access authorities.

V1 has one public/free access class, one closed Membership class and explicit author/admin
permissions. It has no generic policy engine, plan matrix or provider-specific types in the
`ContentAccess` interface.

## Resolved design tree

```text
ContentAccess
├── authority
│   ├── Telegram roster is the external Membership signal
│   ├── Telegram application returns bounded evidence
│   └── Platform owns entitlement and the final decision
├── policy vocabulary
│   ├── Subject: anonymous, human Principal or service Principal
│   ├── Resource: material body, asset or video
│   ├── Action: read, preview, download or play
│   └── Decision: allow/deny + reason + validity + policy version
├── policy inputs
│   ├── Principal status and explicit Platform permissions
│   ├── resource mapping, publication state and access class
│   └── current Platform Membership entitlement
├── delivery callers
│   ├── Next.js/RSC and REST/MCP
│   ├── asset and download endpoints
│   └── playback-token and Kinescope authorization adapters
├── time and failure
│   ├── five-minute positive Membership bound
│   ├── recheck on every new protected operation
│   ├── already delivered bytes cannot be recalled
│   └── stale or unavailable authority fails closed
└── information safety
    ├── public projection never contains closed body data
    ├── protected responses and credentials never enter shared cache
    ├── stable internal reason codes map to coarse public responses
    └── protected decisions are auditable without raw identity/provider data
```

The tree is complete for v1. Provider mechanics that require credentials are production adapter
acceptance checks, not unresolved ContentAccess policy.

## Authority and the Telegram join flow

Joining the Telegram chat does **not** create a Platform account and does not push or import the
whole roster into Platform. The participant first signs in to Platform by email and explicitly
links Telegram through the dedicated Inside bot identity. The Telegram application then verifies
that one linked identity with `getChatMember` and returns normalized, time-bounded evidence.

This choice has three consequences:

1. Platform never needs a full member export or periodic roster synchronization.
2. A person who is only in Telegram leaves no unnecessary identity record in Platform.
3. Tribute remains replaceable: it may add or remove chat members, but neither its payments nor
   webhooks appear in Platform's access contract.

Telegram evidence reaches Platform through authenticated asynchronous ingestion. Member-status
events and provider-owned reconciliation update Platform's local entitlement projection outside
the user-facing request path. A confirmed `not_member` replaces the positive entitlement when
Platform accepts the newer evidence; an outage does not turn the last observation into confirmed
non-membership, but stale positive evidence may no longer grant access.

The selected five-minute positive lifetime means removal from the Telegram chat stops **new**
protected operations within at most five minutes. Rejoining restores access after newer positive
evidence reaches the local projection, without relinking or creating a new Platform account.

## Canonical policy vocabulary

### Subject

```ts
type Subject =
  | { kind: "anonymous" }
  | { kind: "human"; principalId: PrincipalId }
  | { kind: "service"; principalId: PrincipalId };
```

`principalId` is a local opaque Platform identifier resolved from trusted authentication. A caller
cannot provide roles, Telegram identity, email, entitlement or account status as trusted fields.
`ContentAccess` loads current Platform facts itself.

A service Principal, including MCP, has only explicit Platform permissions. It never borrows a
browser session or human Membership entitlement. When a later use case truly needs delegated
access, that becomes a separate design rather than an optional field in v1.

“Author” and “admin” in the access matrix are personas, not Subject variants:

- **author** is an authenticated Principal with explicit permission to preview and manage content;
- **admin** is an authenticated Principal with explicit Platform administration permission;
- v1 may grant both to Kirill, but policy tests keep them distinct;
- disabling a Principal removes these privileges, although public/free content remains public.

### Resource

```ts
type ResourceRef =
  | { kind: "materialBody"; revisionId: MaterialRevisionId }
  | { kind: "asset"; assetId: AssetId }
  | { kind: "video"; videoId: VideoId };
```

References are local immutable identifiers, not URLs, S3 keys or Kinescope IDs. The module resolves:

- the owning Material and revision;
- `draft` or `published` state;
- `free` or `membership` access class;
- whether an Asset or Video belongs to that revision;
- whether the requested action is valid for that resource kind.

A published request can only resolve the Material's `publishedRevisionId`. A draft-only body,
Asset or Video is unavailable to a normal read path even if another revision of the Material is
published. Unknown, cross-material or stale mappings deny; callers cannot repair them by supplying
extra metadata.

Public catalog/search/SEO surfaces read a separate allowlisted `PublicMaterialProjection`
containing cards, title, summary, topic, series and teaser metadata for published Materials. It
never contains a closed body, private locator or delivery credential. Draft discovery and
management permissions remain separate authoring concerns.

### Action

```ts
type ContentAction = "read" | "preview" | "download" | "play";
```

- `read` returns a published body or inline Asset representation.
- `preview` returns a selected draft or published revision and its linked Resources through an
  author/admin surface.
- `download` authorizes delivery of an attached file.
- `play` authorizes a Video playback-token/license operation.

Invalid resource/action pairs deny with `RESOURCE_ACTION_INVALID`. Content creation, editing,
publishing, deletion, taxonomy management and owner GO are not ContentAccess actions; their
command authorization belongs to the authoring module. MCP uses `ContentAccess` when it reads or
previews Resources and the authoring command policy when it mutates them.

## Interface and invariants

```ts
type AccessCaller =
  | "web"
  | "rest"
  | "mcp"
  | "asset"
  | "download"
  | "playbackToken"
  | "videoAuthorization";

type CorrelationId = string & { readonly __brand: "CorrelationId" };
type AccessDecisionId = string & { readonly __brand: "AccessDecisionId" };
type PolicyVersion = string & { readonly __brand: "PolicyVersion" };
type Instant = string & { readonly __brand: "Iso8601Instant" };

type AllowReason =
  | "PUBLIC_RESOURCE"
  | "ACTIVE_MEMBERSHIP"
  | "CONTENT_PERMISSION"
  | "ADMIN_PERMISSION";

type DenyReason =
  | "AUTHENTICATION_REQUIRED"
  | "PRINCIPAL_DISABLED"
  | "MEMBERSHIP_REQUIRED"
  | "MEMBERSHIP_EXPIRED"
  | "ENTITLEMENT_STALE"
  | "CONTENT_PERMISSION_REQUIRED"
  | "RESOURCE_UNPUBLISHED"
  | "RESOURCE_NOT_FOUND"
  | "RESOURCE_MISMATCH"
  | "RESOURCE_ACTION_INVALID"
  | "DEPENDENCY_UNAVAILABLE";

type AccessRequest = Readonly<{
  subject: Subject;
  resource: ResourceRef;
  action: ContentAction;
  caller: AccessCaller;
  correlationId: CorrelationId;
}>;

type AccessDecisionBase = Readonly<{
  decisionId: AccessDecisionId;
  policyVersion: PolicyVersion;
  decidedAt: Instant;
}>;

type AccessDecision =
  | (AccessDecisionBase & Readonly<{ effect: "allow"; reason: "PUBLIC_RESOURCE" }>)
  | (AccessDecisionBase &
      Readonly<{
        effect: "allow";
        reason: Exclude<AllowReason, "PUBLIC_RESOURCE">;
        validUntil: Instant;
      }>)
  | (AccessDecisionBase & Readonly<{ effect: "deny"; reason: DenyReason }>);

interface ContentAccess {
  authorize(request: AccessRequest): Promise<AccessDecision>;
}
```

The single method is the external seam for both callers and policy tests. Its interface includes
these invariants:

1. An `allow` is never permanent. Public access may omit `validUntil`; permission- or
   Membership-based access must not outlive the earliest relevant input.
2. `validUntil` caps derived credentials; it does not permit a caller to skip a new decision for a
   different protected operation.
3. Policy denials and expected dependency failures return a deny decision. Unknown exceptions are
   caught by the caller adapter and translated to the same fail-closed behavior; no adapter has an
   “allow on error” fallback.
4. The module uses an injected clock and internal readers for Principal policy, resource facts and
   entitlement. Tests replace these internal adapters without exposing them to production callers.
5. Every caller supplies only authenticated Subject identity, an opaque Resource reference,
   action and correlation context. Visibility, publication state, permissions and entitlement are
   never caller assertions.
6. A delivery credential is bound to one Subject, one Resource and one action. It cannot be moved
   to another Asset or Video.
7. The interface contains no Logto, Telegram, Tribute, S3 or Kinescope types.

## Access matrix

“Authenticated” below means a valid human Principal without active Membership or content
permissions. Author/admin allows require an enabled Principal and the explicit permission.

| Resource state and action | Anonymous | Authenticated | Active member | Expired member | Author | Admin |
|---|---:|---:|---:|---:|---:|---:|
| Published free body: `read` | Allow | Allow | Allow | Allow | Allow | Allow |
| Published free inline Asset: `read` | Allow | Allow | Allow | Allow | Allow | Allow |
| Published free file: `download` | Allow | Allow | Allow | Allow | Allow | Allow |
| Published free Video: `play` | Allow | Allow | Allow | Allow | Allow | Allow |
| Published free revision/Resource: `preview` | Deny | Deny | Deny | Deny | Allow | Allow |
| Published Membership body: `read` | Deny | Deny | Allow | Deny | Allow | Allow |
| Published Membership inline Asset: `read` | Deny | Deny | Allow | Deny | Allow | Allow |
| Published Membership file: `download` | Deny | Deny | Allow | Deny | Allow | Allow |
| Published Membership Video: `play` | Deny | Deny | Allow | Deny | Allow | Allow |
| Published Membership revision/Resource: `preview` | Deny | Deny | Deny | Deny | Allow | Allow |
| Draft body/Asset/Video: `preview` | Deny | Deny | Deny | Deny | Allow | Allow |
| Draft Resource through normal `read`/`download`/`play` | Deny | Deny | Deny | Deny | Deny | Deny |

Additional rules:

- An authenticated Principal with an unlinked Telegram identity has no Membership entitlement and
  follows the “Authenticated” column.
- A disabled Principal receives no Membership, author or admin privilege. The same request may
  still receive a published free Resource because that Resource is anonymous-public.
- Author/admin permission grants access for content operations independently of Membership; it is
  not encoded by creating a fake entitlement.
- Draft preview does not imply publish permission or owner GO.
- A public card/teaser is not the closed body and is served from the public projection for every
  persona.

## Reason codes and caller mapping

Stable internal reasons:

| Effect | Reason | Meaning |
|---|---|---|
| Allow | `PUBLIC_RESOURCE` | Published Resource is free. |
| Allow | `ACTIVE_MEMBERSHIP` | Fresh Platform entitlement grants the closed Resource. |
| Allow | `CONTENT_PERMISSION` | Explicit author permission grants the requested content action. |
| Allow | `ADMIN_PERMISSION` | Explicit admin permission grants the requested content action. |
| Deny | `AUTHENTICATION_REQUIRED` | Closed operation has no authenticated Principal. |
| Deny | `PRINCIPAL_DISABLED` | Authenticated Principal may not use private privileges. |
| Deny | `MEMBERSHIP_REQUIRED` | No linked/current Membership entitlement exists. |
| Deny | `MEMBERSHIP_EXPIRED` | Historical entitlement exists but is no longer active. |
| Deny | `ENTITLEMENT_STALE` | Positive evidence is past its finite validity. |
| Deny | `CONTENT_PERMISSION_REQUIRED` | Preview or other privileged access is missing. |
| Deny | `RESOURCE_UNPUBLISHED` | Normal delivery attempted to use a draft Resource. |
| Deny | `RESOURCE_NOT_FOUND` | No local Resource exists. |
| Deny | `RESOURCE_MISMATCH` | Asset/Video is not attached to the resolved revision. |
| Deny | `RESOURCE_ACTION_INVALID` | Action is not meaningful for the Resource kind/state. |
| Deny | `DEPENDENCY_UNAVAILABLE` | A required current Platform fact could not be established. |

Internal reasons are not a public resource oracle. Adapters map them as follows:

- web read of a published closed Material renders its public teaser/paywall without fetching the
  body;
- REST/MCP returns `401` for missing authentication, `403` for a known but unauthorized Resource,
  `404` for unknown/mismatched locators where revealing existence is unsafe, and `503` for a
  dependency outage;
- download/asset endpoints return no redirect or body on deny;
- the Kinescope callback returns `403` for every policy denial, malformed request, mapping failure
  or Platform dependency outage after callback authentication; only invalid callback credentials
  receive `401`.

UI copy uses coarse states such as “Войдите”, “Membership не активен” or “Временно недоступно”. It
does not expose internal mapping, dependency or provider details.

## Main flows

### Published read

```mermaid
sequenceDiagram
    participant U as Browser/client
    participant C as Next.js or REST/MCP adapter
    participant A as ContentAccess
    participant P as Platform policy stores

    U->>C: request published Material
    C->>C: resolve optional authenticated Subject
    C->>A: authorize(Subject, revisionId, read)
    A->>P: load Resource, Principal policy, entitlement
    A-->>C: AccessDecision
    alt allow
        C-->>U: body with public/private cache policy
    else published closed Material
        C-->>U: public projection only; no closed body
    else unavailable or unsafe locator
        C-->>U: controlled error; no closed body
    end
```

The adapter does not fetch or serialize the closed body before `allow`. It reads only Platform's
local projection: missing or stale positive evidence denies, and the request neither calls
Telegram nor waits for provider reconciliation. Authenticated ingestion and reconciliation may
update the projection asynchronously for a later request.

### Author preview

```mermaid
sequenceDiagram
    participant U as Author/admin/MCP
    participant C as Preview adapter
    participant A as ContentAccess
    participant P as Platform policy stores

    U->>C: request selected revision preview
    C->>C: authenticate Principal/service Principal
    C->>A: authorize(Subject, Resource, preview)
    A->>P: load enabled status, permission and revision mapping
    A-->>C: allow or deny
    alt allow
        C-->>U: selected revision preview; Cache-Control: private, no-store
    else deny or unavailable
        C-->>U: 403/404/503; no selected revision data
    end
```

Preview access is audited, never share-cached and never changes publication state. Preview links
are not bearer links that bypass the Subject check.

### Download

```mermaid
sequenceDiagram
    participant U as Browser/client
    participant C as Download endpoint
    participant A as ContentAccess
    participant S as Private object storage

    U->>C: request download(assetId)
    C->>A: authorize(Subject, assetId, download)
    A-->>C: decision(validUntil)
    alt allow
        C->>C: mint resource-bound delivery credential capped by validUntil
        C-->>U: short-lived redirect/stream response; no-store
        U->>S: begin transfer
    else deny or unavailable
        C-->>U: no URL and no bytes
    end
```

Closed objects remain private. A signed URL, if selected by the Platform specification, is valid
for the smaller of its delivery cap and the decision's `validUntil`; it never appears in cacheable
HTML, RSC payloads, logs or analytics. An already started transfer cannot be recalled, but expiry
prevents a new transfer from starting with the old credential. If object-store signing cannot meet
these properties, an application streaming proxy is the fallback.

### Kinescope playback

```mermaid
sequenceDiagram
    participant U as Browser
    participant C as Platform playback endpoint
    participant A as ContentAccess
    participant K as Kinescope player/DRM
    participant B as Platform Kinescope callback

    U->>C: request playback token(videoId)
    C->>A: authorize(Subject, videoId, play)
    A-->>C: decision(validUntil)
    alt allow
        C-->>U: short JWT bound to Subject/video, <=120s and validUntil
        U->>K: load protected player
        K->>B: authenticated license callback(id, token)
        B->>B: validate callback auth, JWT and video mapping
        B->>A: authorize(Subject, videoId, play) again
        alt allow
            B-->>K: 200
        else any deny or unavailable
            B-->>K: 403
        end
    else deny or unavailable
        C-->>U: no token; controlled unavailable/paywall state
    end
```

Kinescope DRM authorization must be configured `strict: true`. The short JWT contains opaque local
identifiers, `iss`, `aud`, `exp`, `jti` and the bound Video reference, but no email, Telegram ID,
name or entitlement. Domain restrictions are defense in depth, not authorization.

## Revocation and already-started sessions

A login session identifies a Subject; it is never an access lease. Each new body request, preview,
download initiation, playback-token request and Kinescope callback asks `ContentAccess` again.
Membership is not copied into the session or a long-lived JWT.

The v1 guarantee is intentionally bounded:

- confirmed removal or expiry denies immediately when observed;
- otherwise a last positive Telegram observation may grant new operations for at most five
  minutes;
- a protected response already delivered to a browser cannot be erased;
- a file transfer that already started may finish;
- a newly requested download credential or playback token is capped by the current decision;
- a Kinescope license already issued may continue until provider renewal/callback behavior stops
  it.

Platform therefore promises to stop **new** protected operations within the evidence bound, not
instant remote erasure. The credentialed Kinescope spike must measure the maximum continued-play
window. If that window is unacceptable, the playback path remains controlled-unavailable until a
provider mechanism or replacement adapter meets the bound; the application does not weaken
`ContentAccess`.

## Fail-closed behavior and outages

| Failure | Public/free content | Closed content | Author/admin | Recovery behavior |
|---|---|---|---|---|
| Identity login unavailable | Still public | New login unavailable; unverifiable Subject denied | Unverifiable Subject denied | Existing locally verifiable identity may be used only if its normal contract allows it. |
| Platform Principal/policy store unavailable | Still public from isolated public projection | Deny | Deny | `DEPENDENCY_UNAVAILABLE`, alert; no inferred roles. |
| Entitlement store unavailable | Still public | Deny | Permission-based access may continue if its own facts are available | Never ask callers to trust session claims. |
| Telegram application/API unavailable | Still public | Still-fresh positive entitlement may run to `validUntil`; stale/missing denies | Unaffected by Membership if permission facts are available | Provider delivery/reconciliation retries asynchronously; request shows controlled unavailable UI. |
| Object storage unavailable | Body without failed Asset may render | Asset/download unavailable | Same affected Resource unavailable | No public-bucket or alternate-secret fallback. |
| Kinescope unavailable/callback timeout | Non-video body may render | Video unavailable | Video preview unavailable | Never return callback 200 for availability. |
| Audit sink unavailable | Delivery follows the already computed policy decision | Same | Same | Buffer/best-effort telemetry and alert; audit outage is not an allow condition. |

Public/free survival assumes physically/logically isolated public projections and objects. A caller
must not catch a protected-path failure and fall back to a public lookup of the same closed body.

## Cache, SSR and CDN contract

Allowed in a public/shared cache:

- published `PublicMaterialProjection` cards, teasers, topics and series;
- published free bodies and explicitly public Asset representations;
- public application shell data that contains no Subject-specific decision.

Never allowed in a public/shared cache:

- closed bodies or draft revisions;
- private Asset bytes, object locators or signed URLs;
- playback tokens or Kinescope authorization results;
- Subject-specific access decisions, entitlement state or paywall variants containing private
  data.

Protected Next.js/RSC paths are dynamic and `private, no-store`; they do not use static generation,
shared route/data cache or speculative prefetch containing protected data. `Vary: Cookie` alone is
not accepted as the safety control. Authorization completes before a closed body is loaded into
the render tree, serialized Flight payload or HTML. CDN rules default-deny caching for authenticated
and protected routes, and tests inspect both headers and response bytes across two Subjects.

Free and closed provider objects are distinct by default. Making metadata public must not make an
underlying closed S3 object or Kinescope Video public.

## Audit and privacy

Audit every protected allow/deny, author/admin preview and dependency failure. High-volume
`PUBLIC_RESOURCE` allows may be metrics-only because they grant no private capability; all public
denials remain auditable when they indicate probing or configuration errors.

Minimum audit event:

```text
decisionId, decidedAt, effect, reason, action, caller,
opaque principalId or anonymous, local resource kind/id,
policyVersion, entitlement evidenceRef/version/validUntil when used,
correlationId, latency class
```

Do not log email, name, Telegram ID/username, Tribute data, raw session, authorization headers,
signed URLs, JWTs, query strings, Kinescope token, raw IP or User-Agent in ContentAccess events.
Provider/security logs that truly require network identifiers are separate, access-controlled and
retained for the shortest operational period. Exact retention and deletion schedules belong to
the Platform operational/privacy specification; this report fixes the data-minimization boundary.

Public responses expose only coarse UX states. Internal reason codes, evidence references and
resource-mismatch distinctions are for authorized operations/audit, not browser analytics.

## Testing seam and negative cases

Tests exercise the same `ContentAccess.authorize` interface as production callers. The module
accepts internal in-memory adapters for the clock, Principal policy, Resource facts and entitlement;
route/player/storage fakes exist only outside the module to verify caller behavior. Tests never
mock a route-local Membership boolean because no such seam exists in production.

Required policy matrix tests:

- anonymous, authenticated without Membership, active, expired, author and admin;
- free versus Membership Resource;
- draft versus published revision;
- disabled Principal and service Principal without explicit permission;
- unknown Resource, wrong Material/Asset/Video mapping and invalid action pair;
- positive evidence just before and at `validUntil`, confirmed removal, outage while fresh and
  outage after stale;
- author preview without publish authority and ordinary read of a draft;
- every allow reason and every deny reason.

Required caller contract tests:

- web closed denial returns only the public projection; HTML and RSC bytes contain no closed body;
- REST and MCP cannot bypass the module and map reason classes consistently;
- preview is `private, no-store` and fails without explicit permission;
- inline Asset and download cannot swap IDs across Materials or revisions;
- denied download emits no redirect, signed URL or bytes;
- delivery credential expires no later than `AccessDecision.validUntil` and is bound to one
  Resource/Subject/action;
- Kinescope token is tamper-resistant, expired/wrong-video tokens deny, callback auth is required,
  callback reauthorizes and every timeout/non-allow returns `403` under `strict: true`;
- two Subjects through SSR/CDN never receive each other's body, decision or token;
- a previously active Subject loses every new protected path after the five-minute bound;
- already-started download/play behavior is measured and recorded rather than asserted as instant
  revocation.

A cross-caller conformance fixture runs the same core cases through web, REST, MCP, Asset, download
and video adapters. This is the strongest guard against policy drift.

## V1 and deferred scope

### V1

- one Platform `ContentAccess` module and the interface above;
- published free and one Membership access class;
- human/service Subjects and explicit author/admin permissions;
- `read`, `preview`, `download` and `play` for Material bodies, Assets and Videos;
- one linked Telegram identity and one closed-chat Membership signal;
- five-minute positive evidence lifetime and fail-closed stale/outage behavior;
- private closed Assets, bounded delivery credentials and Kinescope callback reauthorization;
- public projection separation, protected cache contract, audit/reason codes and conformance tests.

### Deferred

- multiple tiers, trials, gifts, promo codes, per-series/product purchases or billing;
- full Telegram roster import, Tribute integration or access from payment events;
- multiple linked Telegram identities and self-service account transfer;
- generic ABAC/RBAC policy engine or IdP-managed Membership roles;
- delegated member access for MCP/service Principals;
- offline viewing, device limits, concurrent-stream limits and watermarking;
- instant recall of delivered bytes or a promise of immediate termination of an issued video
  license;
- provider analytics beyond the separately accepted privacy decision;
- generic multi-provider download/video abstractions before a real second adapter exists.

## Go/no-go and fallbacks

The design is ready to enter the Platform specification. Production delivery of each protected
path remains gated:

| Path | Go | No-go / fallback |
|---|---|---|
| Core policy | One interface passes the complete matrix and all callers use it. | Any route-local Membership rule blocks release; remove duplication before proceeding. |
| Telegram evidence | Credentialed link/member/removal/rejoin proof meets the five-minute bound. | Keep closed access unavailable; never substitute Tribute/email/manual role silently. |
| Closed body/SSR | Two-Subject cache tests prove no body/Flight leak. | Disable caching/prefetch for the route until proven. |
| Assets/download | Private storage and bounded, resource-bound delivery pass negative tests. | Use an application streaming proxy or keep download unavailable. |
| Kinescope | `strict: true`, callback auth, token binding and outage tests deny correctly; continued-play window is acceptable. | Controlled unavailable player; escalate provider mechanics or replace only the adapter. |
| Audit/privacy | Protected decisions are traceable without prohibited raw data. | Block production protected paths until logs are minimized and access-controlled. |

There is no fail-open fallback for closed content.

## Remaining decisions

No product or cross-repository ContentAccess policy decision remains open for v1. The Platform
specification still has to select stage boundaries, concrete delivery mechanisms and operational
retention/deletion periods. Credentialed Telegram, object-storage and Kinescope checks still have
to prove their adapter contracts. Those are specification and production-acceptance inputs, not
permission to change the access matrix or fail-open during an outage.

## Handoff to Platform specification and ADRs

This research closes the policy decision; it does **not** create implementation issues. Workspace
issue #40 must use it to choose vertical stages, dependencies and the first ready tasks in owning
repositories.

Candidate task areas for #40, not a speculative backlog:

1. Platform core `ContentAccess` interface, facts/readers, policy matrix and conformance fixture.
2. Public projection plus Next.js/REST/MCP read and preview adapters with cache-leak tests.
3. Platform entitlement projection/ingestion adapter and authenticated contract with
   `inside-telegram`.
4. Private Asset/download delivery adapter and cross-revision negative tests.
5. Kinescope playback-token/callback adapter and credentialed production acceptance proof.
6. Audit/observability/privacy controls and outage runbooks.
7. Provider convergence with the autonomous Telegram root Specification and its vertical tickets.

Application ADR inputs:

- **Platform:** place the `ContentAccess` seam in the application layer and require every content
  delivery adapter to consume it; record exact module/package ownership after the core proof.
- **Platform:** select the concrete private Asset delivery mechanism and credential caps after its
  negative proof.
- **Platform:** record Kinescope DRM/callback configuration only after the credentialed proof,
  including the measured continued-play bound.
- **Telegram application:** application ADR inputs belong to its owning Specification; the former
  OIDC/linking proposal is superseded by the
  [shared Identity and Membership contract](../contracts/identity-membership-v1.md).

These ADRs belong to their application repositories. Workspace retains this cross-repository
authority split and policy design without duplicating application structure.

## Inputs

- [Platform v1 product brief](https://github.com/sachkov-inside/platform/blob/main/docs/product/platform-mvp-brief.md)
- [Identity architecture](platform-identity-architecture.md)
- [Telegram Membership authority and application](platform-telegram-tribute-membership.md)
- [Kinescope lifecycle and authorization adapter](platform-kinescope-video-lifecycle.md)
- [Content authoring model](platform-content-authoring-model.md)
- [Current publishing audit](platform-current-publishing-audit.md)
- [Workspace Wayfinder #38](https://github.com/sachkov-inside/workspace/issues/38)
