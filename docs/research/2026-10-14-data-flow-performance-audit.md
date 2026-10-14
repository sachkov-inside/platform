# Data-flow and performance audit

Status: research snapshot, not an accepted implementation plan.
Date: 2026-10-14.
Source baseline: `2b650e946af93d409a8d1518a2eda12b65247fed` plus the inspected working tree.

## Purpose and evidence boundary

The owner requested an audit of the data flow, caches, unnecessary React effects,
pagination, cursor pagination, N+1 reads, and common optimization problems. Record
findings now; select a plan and implementation work later.

This audit changes no application code or accepted product contracts. Evidence is
source inspection, call-chain analysis, existing tests inspected as contracts, and
small deterministic reproductions where stated. It does not establish production
latencies, actual query counts, query plans, or current CI acceptance. Existing
tests mentioned below were not run as part of this source audit unless explicitly
listed under Verification.

Use these classifications:

- **Confirmed correctness defect**: a supported input or reachable state produces
  an incorrect result, with its trigger identified.
- **Confirmed amplification**: the call chain performs work for each input item.
  This alone does not establish a production bottleneck.
- **Confirmed dependency/cost**: unnecessary waiting or eager fixed-cost reads are
  present in code; their latency impact needs measurement.
- **Candidate**: a plausible improvement that needs runtime evidence or a product
  decision before promotion to implementation.
- **Preserve**: existing behavior that is useful or necessary, not an audit defect.

Do not interpret every effect as removable, every complete list as a pagination
defect, or every loop as N+1. Effects can own external synchronization. A bounded
composition can need complete ordering. Writes and provider effects can require
sequential execution. `Promise.all` changes concurrency; it does not turn individual
reads into a batch query. Prisma can combine compatible parallel `findUnique`
calls, so an owner-call count is not automatically an SQL round-trip count.

## Current architecture to preserve

- `GET /materials/:slug` already includes authorization and returns either a body
  or an access-safe teaser. A new separate permission endpoint is unnecessary for
  ordinary material reads. [Material reader](../../apps/backend/src/modules/materials/features/read-published-material/read-published-material.ts#L63).
- Programme discovery returns cards with availability, not all lesson bodies.
  Availability is processed in batches of at most 100 operations. Rights facts are
  read once per rights batch, not once per material.
  [Catalog projection](../../apps/backend/src/modules/content-library/shared/project-published-catalog-items.ts#L124),
  [rights batch](../../apps/backend/src/modules/account-rights/features/resolve-membership-for-access/resolve-membership-for-access.ts#L105).
- Next.js owns a guest cache; personalized reads stay outside that shared cache.
  Browser route retention is 60 seconds on these surfaces. Public cache profiles
  are 300 seconds for found content and 30 seconds for missing content. Dependency
  failures use `stale: 0`, `revalidate: 0`, and `expire: 1` seconds.
  [Configuration](../../apps/web/next.config.ts#L95),
  [catalog invalidation](../../apps/web/src/shared/api/catalog-cache.server.ts),
  [navigation contract](../adr/0027-web-navigation-and-caching.md).
- TanStack Query owns interactive catalog/progress state. Its default freshness is
  30 seconds; inactive retention is 30 minutes. Retention is not freshness or an
  authorization lifetime. The main material body uses server rendering.
  [Query client](../../apps/web/src/shared/api/query-client.ts),
  [catalog query](../../apps/web/src/features/library-catalog/model/use-library-catalog-query.client.ts).
- Personal backend responses use `private, no-store`. The inspected authorization
  path reads database facts; this HTTP header is not an internal result-cache
  implementation. Body delivery checks content versions. Files and protected video
  have their own authorization points.
  [HTTP policies](../../apps/backend/src/infrastructure/http/http-cache-policy.ts),
  [body version read](../../apps/backend/src/modules/materials/infrastructure/postgres/current-material.ts#L124),
  [video playback](../../apps/backend/src/modules/materials/facets/video-playback/video-playback.ts).
- The existing Logto BFF session and server-held bearer-token flow need not be
  replaced to optimize database work. Business authorization is not snapshotted
  into the authentication token. [Identity decision](../adr/0006-logto-session-and-local-account.md).

## Findings retained from the access-flow investigation

### FLOW-01 — Private lesson text waits for auxiliary practice data

Classification: confirmed dependency; user-visible impact requires measurement.

Evidence: `PersonalMaterialReader` awaits one `Promise.all` containing the material,
series, reader mode, hint state, and practices before returning the reader. The
free-material path already places practice actions behind their own Suspense
boundary. [Reader](../../apps/web/src/_pages/material-reader/ui/material-reader-page.tsx#L205),
[free-material path](../../apps/web/src/_pages/material-reader/ui/material-reader-page.tsx#L126).

Impact: a slower practice read delays display of an already available private body.
Parallel starts do not remove this final dependency.

Direction: give optional practice data its own completion boundary. Preserve reader
mode and series data that determine which body variant and navigation are correct.

Verification criterion: delay or fail the practice endpoint while allowing the
material endpoint to succeed. The permitted body should become visible without
waiting for practices; practice state should resolve separately.

### FLOW-02 — Resource authorization eagerly reads full account-rights facts

Classification: confirmed fixed cost; not N+1 by itself.

Evidence: `readAccessCapabilityFacts` sequentially reads non-revoked, not-ended grants,
classification, revision, historical material grants, binding, and the last accepted
evidence receipt. An enabled legacy bridge adds a projection read. The resource
resolver only exposes membership and its expiry, although the common projection
also computes revision and the next time boundary.
[Facts](../../apps/backend/src/modules/account-rights/features/resolve-access-capabilities/resolve-access-capabilities.ts#L37),
[resource resolver](../../apps/backend/src/modules/account-rights/features/resolve-membership-for-access/resolve-membership-for-access.ts#L65).

The grant query also returns future grounds. The projection handles `startsAt`
before treating them as active; it needs them for the next time boundary.

Impact: six fact SELECTs in the ordinary path, seven with the bridge, excluding
transaction setup and other resource queries. These costs repeat across independent
authorization operations.

Direction: investigate a demand-driven resource projection that avoids fields and
history not required by the outcome. Keep all applicable expiry sources, including
the bridge, and the consistent transaction snapshot. Do not substitute a long-lived
permission cache or assume `Promise.all` inside one database transaction provides
query parallelism.

Verification criterion: measure SELECT counts for active purchase, active
subscription, expired scope, no right, and legacy bridge. Compare decisions and
`validUntil`, including several concurrent grounds and boundary times.

### FLOW-03 — Course blocks repeat orchestration of the same viewer state

Classification: candidate; repeated function calls do not prove duplicate HTTP.

Evidence: `PersonalCohortCall`, `PersonalCohortStatus`, and
`PersonalCohortCountdown` separately read access/sale/cohort data. The call block
checks access before a sale read, which can check the same access again. Sale reads
already start offers, cohort, and access in parallel.
[Blocks](../../apps/web/src/_pages/library-discovery/ui/cohort-call.server.tsx#L44),
[sale](../../apps/web/src/entities/subscription/api/product-sale.server.ts#L38).

The pinned Next.js GET request memoizer can combine identical URL/header reads
within a render. Public data-cache misses, different viewer headers, request
contexts, and genuine dependent endpoints must be counted separately. `no-store`
does not by itself prove the absence of render-local deduplication.

Direction: measure real outbound requests before deciding whether shared
request-scoped sale/cohort results or a narrower owner interface are worthwhile.
Avoid a new universal page endpoint without evidence.

Verification criterion: record outbound paths and counts for guest, owner of the
product, and signed-in non-owner on cold and warm renders. Preserve current price,
cohort, and eligibility freshness.

### FLOW-04 — Closed guest lesson performs another guest material read

Classification: confirmed adapter path; actual network repetition needs tracing.

Evidence: `readPublicMaterial` provides a shared teaser; `PersonalMaterialReader`
then calls `loadMaterialReader(slug, undefined)` unless the shared result already
has an available body. Both adapters reach the same material endpoint without a
bearer token, but run through distinct cache owners.
[Page](../../apps/web/src/_pages/material-reader/ui/material-reader-page.tsx#L205),
[guest cache](../../apps/web/src/_pages/material-reader/api/public-material.public-cache.server.ts),
[personal adapter](../../apps/web/src/_pages/material-reader/api/load-material-reader.ts).

Direction: investigate reuse of the shared teaser fields while reading current
purchase eligibility separately. The guest cache deliberately removes purchase
state, so simply skipping the second read could change the invitation behavior.

Verification criterion: compare material request counts and displayed purchase
actions on guest cold/warm renders, including sale changes between requests.

### FLOW-05 — Purchase invitation fans out across every product of a material

Classification: confirmed frontend owner-call amplification.

Trigger: a locked material opened without an explicit product return context.
With an explicit context, this code checks one `returnProductSlug` instead.

Evidence: `soleSoldMembership` calls `productIsSold` for every product slug.
Each call reads product composition, then a full sale only when composition is
`ready` or `empty`. The sale reads offers
and all cohorts; signed-in reads also check product access. The result needed by
this caller is just whether that product is sold.
[Fan-out](../../apps/web/src/_pages/material-reader/ui/material-reader-page.tsx#L449),
[sale composition](../../apps/web/src/entities/subscription/api/product-sale.server.ts#L38),
[cohort list](../../apps/web/src/entities/subscription/api/billing-catalog.server.ts#L111).

Impact: work grows with the number of product memberships on a locked material.
Different product URLs and offer filters cannot all collapse into one identical
GET. Common cohort reads might deduplicate within the render. With one product,
the extra work is bounded; this is not a measured production bottleneck.

Direction: consider a bounded owner batch for product sale availability or a narrower
availability read that does not assemble the entire catalogue and reader access.
Preserve the rule that an invitation cannot choose arbitrarily among several sold
products.

Verification criterion: request a locked material with 1, 10, and 100 memberships.
Count actual backend calls, payload bytes, and time to the invitation. Confirm the
same sole-product/ambiguous/no-sale result for all cases.

## React effect audit

Detailed evidence and the complete callsite inventory:
[Frontend effects](2026-10-14-performance-audit/frontend-effects.md).

Coverage: 87 production callsites in 58 files: 81 `useEffect`, six
`useLayoutEffect`. Stories, generated code, fixtures, and Storybook infrastructure
are excluded. Most effects own external synchronization; no broad effect-derived
filter/map state pattern was found.

| ID | Classification | Finding |
| --- | --- | --- |
| EF-1 | Confirmed permitted concurrency; conditional correctness/load risk | Five-second deletion polling allows overlapping POST reconciliations and stale response application. |
| EF-2 | Confirmed low-impact cleanup | BillingContactPanel retains an optional callback effect with no production consumer. |
| EF-3 | Confirmed low-impact cleanup | Authoring's draft-ref layout effect repeats assignments already made by every current draft setter. |
| EC-1 | Measurement candidate | Per-consumer billing/contact fact-channel subscriptions may repeat listener work; this does not prove duplicate HTTP. |
| EC-2 | Design/measurement candidate | Accepted task feedback updates a layout-owned draft after commit; preserve revision and unsaved-text guarantees. |
| EC-3 | Measurement candidate | Responsive variant-image request discovery waits for width/theme detection after hydration. |
| EC-4 | Measurement candidate | Non-home routes prefetch the home feed; compare navigation benefit with unused traffic. |

Do not delete synchronization for DOM dialogs, observers, players, editor, autosave,
external stores, fact announcements or browser history merely to reduce the effect
count. The detailed report lists each retained callsite and its owner.

## Pagination audit

Detailed endpoint/consumer evidence, the deterministic cursor reproduction, and
coverage inventory: [Pagination](2026-10-14-performance-audit/pagination.md).

| ID | Classification | Confirmed behavior and trigger |
| --- | --- | --- |
| PAG-01 | Correctness defect, deterministically reproduced | An accepted 160-character Cyrillic title generates a 635-character title-sort cursor; response/request limits are 512. A nonfinal page ending on that title cannot continue correctly. |
| PAG-02 | Correctness defect at a scale boundary | Sitemap stops after 100 HTTP catalog pages of 12 items and returns ready even with a continuation: at most 1,200 catalog materials. |
| PAG-03 | Correctness defect in empty-page handling | A raw bookmark page containing only unpublished Materials projects empty but has a cursor; the UI claims emptiness before rendering continuation. |
| PAG-04 | Correctness defect in continuation-failure handling | A failed second bookmark page becomes a nonready page with no next cursor. Existing cards remain but error/retry disappears. |
| PAG-05 | Missing continuation in complete owner surfaces | Billing owner loader drops payment-option continuation after the first 100 rows. People tier selector drops tier continuation after 100, before assignability filtering. |
| PAG-06 | Missing history continuation | Learner attempt history takes 50 with no cursor/truncation state, while the UI promises retained previous attempts. After 51 attempts, the oldest becomes unreachable through that history, not deleted. |
| PAG-07 | Correctness defect at a directory bound | Author submissions first gather all task Product IDs, then pass one set to a max-100 directory. Tasks in 101 Products fail even a one-Product request. |
| PAG-08 | Confirmed hidden unbounded work | Each People page materializes global timed-enrollment/grant history; Offer filtering also loads all matching confirmed purchases before bounded selection. Runtime cost is unmeasured. |

Six scale/contract candidates remain separate from confirmed correctness defects:
learning-task catalog's 500 cap; chapter-task composition's 500 cap; global cohort
list's 100 cap; unbounded author collection/reference selectors; whole-catalog
facets/counts on each page; and recent-only payment/notice/audit histories whose UI
promise needs clarification. Each detailed item has a boundary verification criterion.

Correct existing tuple keysets, UUID tie-breakers, filter fingerprints, account/bot
scope predicates, load-more concurrency guards and explicit pagination-budget
failure should remain. Cursor pagination does not imply a stable snapshot across
edits or changing permissions. Complete programme composition and bounded ID lookup
interfaces should not automatically become infinite feeds.

## Backend and Telegram batch audit

Detailed evidence, exact call chains, bounds, and verification criteria:
[Read batching](2026-10-14-performance-audit/read-batching.md).

Search inventory: 859 non-test TypeScript paths in 18 Backend Modules, 12 Telegram
Modules, and four shared packages; 298 loop/async-map/Promise-all source lines.
These counts describe search coverage, not manual review of every function.

| ID | Confirmed read amplification | Bound or scale condition |
| --- | --- | --- |
| N1 | Offer pricing reloads option/promotions and counts promotion usage per option. | Up to 100 options per page; per-option promotion count has no local cap. |
| N2 | Enrollment views read grants, source state, catalog and owner history per enrollment. | Outer Account enrollment list is unbounded. |
| N3 | Practice listing repeats snapshots and authorization for the same Material. | No limit in the initial Practice-ID read; at least 1 + 2N raw Practice reads. |
| N4 | Telegram statistics read history, first and latest entry per contact. | Up to 100 contacts and 300 additional entry statements. |
| N5 | Telegram author lists reuse single-item read/replay/authorization/lock machinery. | Ten displayed items; bounded but repeated owner work. |
| N6 | Telegram contact enrichment batches input but does link reads before/after each provider lookup. | Four concurrent provider calls; local reads can be batched without inventing a bulk Telegram API. |
| N7 | Members-without-right resolves complete capability facts per observed member. | Up to 1,000 snapshot transactions and 6,000–7,000 fact reads. |
| N8 | Notification audience expansion reads access, bindings and preferences per Account. | 25 Accounts per checkpoint; total work grows with audience. |
| N9 | Task assets batch within each Material, but read presentations once per Material group. | Distinct referenced Material groups; existing partial batching should remain. |
| N10 | Communication destination validation reads each distinct URL target separately. | Number of accepted same-origin destinations; no cap in this helper. |
| N11 | Consent validation uses one findFirst per evidence reference. | At most four references; low fixed amplification. |

Six additional candidate groups remain conditional: compatible Prisma `findUnique`
fan-out; quadratic in-memory joins/global timed-enrollment scans; repeated bounded
series continuation; reconciliation workers; single-member provider lookup; and
cleanup/renewal transactions. The detailed report separates reads from required
locks, writes, safety rechecks and provider effects.

Existing resource/rights batches, asset sets, progress batches, identity chunks,
grouped collection counts and timeline delivery reads should remain. In particular,
`checkAvailabilityMany` batches resources for one subject; it is not a ready-made
many-Account authorization batch.

## Follow-up implementation specification

[Standards mapping](2026-10-14-performance-audit/standards-mapping.md) covers every
one of the 43 records. Reusable rules live in root, Backend and Web coding standards;
concrete defects and conditional candidates remain here and in the specification.
The new rules are prepared worktree changes until integrated, not evidence of fixes.

The owner requested one implementation specification after this audit.
[GitHub issue #1466](https://github.com/sachkov-inside/platform/issues/1466)
is the authoritative assignment prepared for a new session. It includes all 43
FLOW/EF/PAG/N/EC/PC/BC records, acceptance criteria, preservation constraints,
conditional-candidate dispositions, and final verification requirements. Its body
is self-contained; these local research files are supplementary evidence.

Publication of the specification does not mean any audited application path has
been fixed, measured in production, or accepted after implementation.

## Verification and limitations

- `pnpm docs:check`: passed. The command also reported an existing length warning
  for `apps/web/CODING_STANDARDS.md`. The later standards follow-up changes that file;
  its verification is recorded separately from this original audit run.
- Checked 158 local Markdown links across the four final reports, including file
  existence and referenced line bounds: no failures.
- Re-executed the exact catalog encoder body with accepted 160-character ASCII,
  Cyrillic, and CJK titles: encoded lengths 422, 635, and 848. Installed Zod accepts
  the metadata but rejects the two cursors over 512 characters.
- An independent worker reviewed FLOW-01 through FLOW-05 and PAG-01 through PAG-08
  against source. Corrected future-grant wording, cache failure expiry, the
  no-product-context fan-out trigger, and which history attempt becomes hidden.
- The coordinator inspected the three effect findings and representative read
  chains, including Offer pricing, enrollment views, Practice lists, community
  reporting, and Telegram entry statistics. The detailed reports define the
  remaining search/manual-review boundaries.

No application test suite, CI, production database trace, query-plan analysis,
benchmark, full security audit, implementation plan, tickets, application-code
fixes, PR, or deployment is included in the source audit. The follow-up specification
was published separately as #1466. Latency and
traffic rankings remain unmeasured. Choose the improvement plan separately using
these verified triggers and the measurement criteria, rather than treating every
record as an urgent defect.
