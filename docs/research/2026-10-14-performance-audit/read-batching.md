# Production read batching audit

Date: 2026-10-14. Source head: `2b650e946af93d409a8d1518a2eda12b65247fed`.

This is a static source audit, not a production measurement. No application code changed.
The strongest opportunities are enrollment lists, Offer pricing, published Practice lists,
Telegram communication statistics, and the community members-without-right report.

## Scope and evidence strength

The inventory covered 18 backend Modules, 12 Telegram Modules, and four shared packages.
The source inventory contained 859 non-test TypeScript paths: 685 backend, 119 Telegram,
2 access-capabilities, 21 legal, and 32 material-blocks. Runtime-identity contains no TypeScript
paths in that inventory. A loop/async-map/Promise-all scan returned 298 source lines.
These counts describe search coverage, not a claim that every function received a manual review.

Backend inventory: identity-principals, reading-activity, materials, account-rights,
telegram-membership, content-library, content-access, web-telemetry, videos, bookmarks,
accounts, member-profiles, assets, notifications, sales-funnel, billing, communications,
and product-tasks. Telegram inventory: webhook, update-inbox, membership-evidence,
subscription-activation, identity-linking, bot-contacts, outbound, community, bot-sign-in,
notifications, sales-funnel, and communications. Package inventory: runtime-identity,
access-capabilities, material-blocks, and legal.

Manual follow-through focused on collection reads, asynchronous loops, grouped rendering,
permission/resource checks, and worker candidate lists. It followed the callees that own
SQL/provider access for the findings below. Pure domain loops, response projection, deterministic
registry work, and fixed-size image transformations were inspected as different cost classes.

Excluded: web frontend/BFF code, test fixtures, migrations, seeds, generated-client internals,
repository operations scripts, live external APIs, query plans, and actual request frequencies.
Application composition and provider adapters were read where necessary to establish call chains.
No live deployment, SQL trace, or latency benchmark was run.

“N+1” below means a collection read followed by reads per returned item. Some findings are
per-item reads without a literal initial database collection read. Serial `findMany`, `findFirst`,
raw SQL and `count` calls establish query fan-out directly. A `Promise.all` of owner calls does
not itself establish physical SQL count: Prisma can batch compatible concurrent `findUnique`
calls. Those cases are explicitly separated below. Query numbers count owning calls/statements,
not unmeasured ORM relation-load internals, network packets, transaction setup or advisory locks.

## Confirmed read fan-out

### F1. Offer listing repeatedly reads pricing facts and promotion usage

- Chain: [`listOffers:96`](../../../apps/backend/src/modules/billing/features/list-offers/list-offers.ts#L96)
  awaits `selectPrice` for each page item. [`selectPrice:31`](../../../apps/backend/src/modules/billing/shared/select-price.ts#L31)
  reloads the option with its Offer, reads active promotions at line 75, then awaits a reservation
  `count` for every applicable usage-limited promotion at line 94.
- Bound: page limit 100, default 50 (`listOffersSchema`, line 24). Active promotion count has no
  explicit cap in `selectPrice`. Normal eligible rows cost one collection query plus
  `N × (2 + applicable limited promotions)` owning reads. Earlier rejection reduces this count.
  The promotion query is identical across options at the same clock and promo code.
- Direction: list option/Offer facts together, fetch candidate promotions once, and group reservation
  counts by promotion ID. Share a pure price projection with single-option purchase logic.
  Preserve eligibility, promotion precedence, usage limits, and catalog visibility.
- Criterion: with 1, 50 and 100 options sharing promotions, SQL reads grow with chunks rather than
  options; adding limited promotions uses a grouped count. Compare exact prices and omitted offers.

### F2. Enrollment views issue queries per enrollment without a list bound

- Chain: [`readOwnEnrollments:496`](../../../apps/backend/src/modules/account-rights/facets/access-grants/assemble-access-grants.ts#L496)
  and [`listEnrollments:565`](../../../apps/backend/src/modules/account-rights/facets/access-grants/assemble-access-grants.ts#L565)
  first load all Account enrollments. Their async maps perform `accessGrant.findMany` for each row.
  Non-revoked Tribute rows also call [`enrollmentSourceState:61`](../../../apps/backend/src/modules/account-rights/shared/enrollment-view.ts#L61),
  which performs `sourceEntitlement.findFirst`. The owner list additionally reads up to 100 changes
  **per enrollment**. Optional content resolution calls [`CoverageCatalog.resolve:31`](../../../apps/backend/src/modules/materials/facets/coverage-catalog/coverage-catalog.ts#L31),
  which executes another raw query per row. The class is wired by account-rights.module.ts:59.
- Bound: no `take` or pagination for the outer enrollment list. `Promise.all` runs these `findMany`,
  `findFirst`, and raw reads per enrollment; it does not turn them into one collection query.
  Own views have `1 + N` grant reads plus Tribute and catalog reads. Owner views add N history reads.
- Live caller: [`manage-subscription.controller.ts:127`](../../../apps/backend/src/modules/billing/features/manage-subscription/manage-subscription.controller.ts#L127)
  calls `readOwnEnrollments` for the current Account.
- Direction: fetch grants and source states by enrollment-ID sets; union catalog references once.
  Use per-enrollment top-100 history semantics, for example partitioned SQL, rather than a global
  100-row limit. Consider pagination only as a separate public-contract decision.
- Criterion: trace 1, 10 and 100 enrollments, including Tribute and overlapping coverage.
  Assert constant/chunked read count, identical states, terms, catalog order, and each history limit.

### F3. Published Practice listing repeats the same Material authorization

- Chain: [`assembleListPublishedPractices:136`](../../../apps/backend/src/modules/materials/features/read-published-practice/read-published-practice.ts#L136)
  reads IDs, then serially calls the single-item reader at line 160. Each reader performs two
  [`loadPracticeSnapshot:30`](../../../apps/backend/src/modules/materials/features/read-published-practice/practice-snapshot.ts#L30)
  raw queries, with [`contentAccess.authorize:185`](../../../apps/backend/src/modules/content-access/facets/content-access/assemble-content-access.ts#L185)
  between them. This re-reads Material facts, author permission, and relevant membership facts.
  All initial IDs belong to the same requested Material slug (`practice-snapshot.ts:51`).
- Bound: the ID query has no limit. The path costs at least `1 + 2N` raw Practice reads,
  plus N authorizations on normal successful items. Failure stops the list early.
- Direction: load Practice snapshots as a set, authorize the owning Material once, and validate
  the set after that authorization. Keep the second validation phase: it rejects concurrent
  withdrawal, version changes, rebinding, and source changes.
- Criterion: multiple Practices cause fixed/chunked reads; tests still reject withdrawal and
  rebinding between snapshot and authorization. Do not replace the two-phase safety contract
  with a stale cached authorization.

### F4. Telegram statistics load three entry queries per contact

- Chain: [`readStatistics:266`](../../../apps/telegram/src/modules/communications/communication-statistics.ts#L266)
  loops through the contact page, calls [`readEntries:113`](../../../apps/telegram/src/modules/communications/communication-statistics.ts#L113),
  then separately reads the first and latest entry. `readEntries` loads 101 rows for its own
  per-contact 100-entry cursor.
- Bound: 100 contacts per page, so up to 300 additional sequential entry statements after the
  page and aggregate reads. The history result can contain 10,000 entries across the page.
- Direction: batch entry histories by contact ID with per-contact ranking, and derive first/latest
  using partitioned queries or aggregates. Preserve `entered_at, update_id` tie-breaking and
  independent next-entry cursors.
- Criterion: 100 contacts require a fixed number of entry queries; compare first/latest sources,
  entry order, and cursors for contacts with 0, 1, 100 and 101 entries.

### F5. Telegram author lists invoke full single-item operation machinery per item

- Chain: [`AuthorBroadcastDrafts.list:64`](../../../apps/telegram/src/modules/communications/author-broadcast-drafts.ts#L64)
  lists IDs then awaits `read` ten times at most. `read` fetches a draft and calls `Funnels.execute`
  with `broadcasts.read`. [`AuthorFunnelDrafts.list:38`](../../../apps/telegram/src/modules/communications/author-funnel-drafts.ts#L38)
  reads a draft per ID; for non-draft items it invokes `funnels.read`.
  [`Funnels.execute:91`](../../../apps/telegram/src/modules/communications/funnels.ts#L91) repeats author
  authorization, operation replay lookup, and locks before the item lookup. The owning saved-row
  reads are `broadcasts.ts:62` and `funnels.ts:340`.
- Bound: 10 visible items, 11 IDs fetched for a cursor. Broadcasts normally cause ten draft and
  ten saved-row reads, plus operation machinery. Funnels have ten draft reads and saved-row
  machinery for each missing draft. Draft preference/fallback conditions affect counts.
- Live caller: `author-admin.ts:458` and `:474` call these two list methods.
- Direction: provide an owner-scoped list read that fetches drafts and saved rows in sets and
  authorizes once. Preserve bot/author ownership, unpublished scratch drafts and draft naming.
  Do not parallelize lock-bearing operations merely to hide their repeated work.
- Criterion: compare lists for saved, unsaved and edited items; query/authorization counts stay
  fixed for ten items and cursors remain identical.

### F6. Telegram contact enrichment batches transport input, but not local link reads

- Chain: [`TelegramContacts.read:25`](../../../apps/telegram/src/modules/identity-linking/telegram-contacts.ts#L25)
  accepts queries and runs four `readContact` calls at a time. Each matched contact does
  [`findPlatformLink:76`](../../../apps/telegram/src/modules/identity-linking/platform-links.ts#L76), a
  profile read, and another link read to reject races. The Kysely query executes at line 97.
  [`GrammyContactProfileAdapter:41`](../../../apps/telegram/src/adapters/telegram/grammy-contact-profile.adapter.ts#L41)
  calls `getChat`; `app.module.ts:149` selects it only when a bot token exists.
- Bound: four concurrent contacts and one shared 3.5-second upstream budget. Each linked contact
  normally adds two SQL statements and one provider call. Missing links stop after one query;
  expired budget stops before the profile and second query. Provider-disabled composition still
  performs local lookup/recheck for linked contacts.
- Direction: batch initial link snapshots, keep bounded provider requests, then batch revalidation.
  A transport batch does not imply Telegram supports a bulk `getChat` operation. Preserve identity
  and transaction-ref comparisons across the external lookup.
- Criterion: trace 1, 20 and 100 contact requests; local reads grow by chunks, provider concurrency
  stays at four or an explicitly chosen limit, and transfer/unlink races never expose stale names.

### F7. Community members-without-right report resolves capabilities per observed member

- Chain: [`listMembersWithoutRight:428`](../../../apps/backend/src/modules/telegram-membership/facets/community-entitlements/community-entitlements.ts#L428)
  serially calls `grants.resolveCapabilities` for every member observation.
  [`resolveCapabilities:727`](../../../apps/backend/src/modules/account-rights/facets/access-grants/assemble-access-grants.ts#L727)
  opens a snapshot transaction and invokes [`readAccessCapabilityFacts:40`](../../../apps/backend/src/modules/account-rights/features/resolve-access-capabilities/resolve-access-capabilities.ts#L40).
  That function issues six sequential owning reads, plus one projection lookup when a legacy bridge
  is enabled. The REST adapter is `community-delivery.controller.ts:77`.
- Bound: 1,000 observations (`MEMBERS_WITHOUT_RIGHT_SCAN_LIMIT`, line 72); only member observations
  enter the expensive chain. Worst-case 1,000 separate snapshot transactions and 6,000–7,000 fact
  reads, excluding transaction setup. Truncation is reported after 1,001 fetched observations.
- Direction: introduce an Account-set capability fact read in the owning Module, then project
  each Account independently. Keep one coherent fact snapshot and current legacy/evidence rules.
- Criterion: 1, 100 and 1,000 observed members require chunked fact reads, with equivalent positive,
  absent, expired and bridge rights; report truncation and failure behavior stay intact.

### F8. Notification expansion has bounded per-recipient fact reads

- Chain: [`readAudienceFacts:216`](../../../apps/backend/src/modules/notifications/features/expand-audience/expand-audience.ts#L216)
  checks content access per Account, then reads both channel bindings. `AUDIENCE_BATCH_SIZE` is 25
  (line 88). [`notifications.module.ts:102`](../../../apps/backend/src/modules/notifications/notifications.module.ts#L102)
  maps `canRead` to single-resource authorization. This repeats the same Material lookup for each
  Account. [`assembleNotificationRecipients:30`](../../../apps/backend/src/modules/notifications/assemble-notification-recipients.ts#L30)
  uses `NotificationAccounts.binding` and `TelegramAccountLinks.readBinding`, both single-row reads.
  [`expandRow:317`](../../../apps/backend/src/modules/notifications/features/expand-audience/expand-audience.ts#L317)
  additionally calls `optedIn` separately for both channels on material notices.
- Bound: 25 Accounts per expansion checkpoint. Processing the entire audience scales with its size.
  This is bounded worker fan-out, not one unlimited HTTP list. Access failure stops later fact reads.
- Direction: batch shared Material facts and per-Account bindings/preferences inside their owning
  Modules. Existing `checkAvailabilityMany` batches resources for **one subject**; it cannot simply
  substitute for a many-Account decision. Keep writes, locks, idempotent delivery creation and
  checkpoint advancement ordered as required.
- Criterion: compare read count per 25-recipient checkpoint and end-to-end throughput; test opt-out,
  denied access, unavailable dependencies and retry checkpoint correctness. Do not batch away the
  authoritative checks made immediately before dispatch.

### F9. Task page assets batch within each Material, but query per Material group

- Chain: [`task-page-view.ts:93`](../../../apps/backend/src/modules/product-tasks/shared/task-page-view.ts#L93)
  groups referenced assets by Material, then serially calls `loadPresentations` for each group.
  [`loadPresentations:402`](../../../apps/backend/src/modules/assets/facets/material-assets/assemble-material-assets.ts#L402)
  performs `materialAsset.findMany` with an ID set and Material filter.
- Bound: query count is distinct referenced Materials, not individual assets. No explicit group
  limit exists in this helper. This is partial batching; many images from one Material cost one
  owner read. Multiple Materials cause one owner read per group.
- Direction: consider a many-Material presentation read keyed by Material/asset pairs. Preserve
  ownership checks rather than accepting only a loose asset-ID union.
- Criterion: pages referencing 1 and 20 Materials use chunked statements and reject mismatched
  ownership; measure actual group counts before prioritizing this over higher-volume lists.

### F10. Communication target validation reads one destination at a time

- Chain: [`validateTargets:29`](../../../apps/backend/src/modules/communications/features/validate-targets/validate-targets.ts#L29)
  deduplicates URL strings, then serially calls `targets.check`. The production owner is
  [`PublicContentTargets.check:41`](../../../apps/backend/src/modules/materials/facets/public-content-targets/public-content-targets.ts#L41),
  which reads a Material or Product by slug. Parsed URLs resolve to Material/Product kinds;
  its separate `series` branch is not reached by `parseUrl` here.
- Bound: distinct accepted same-origin URLs in the supplied parts; the helper has no own cap.
  URL deduplication helps repeated exact URLs, but resource-equivalent URL spellings can remain.
  The owner is called by `validate-author-content.ts:27` and `communications.ts:85`.
- Direction: parse and deduplicate resource keys, fetch Materials and Products by slug sets,
  then associate reasons with the original URL strings.
- Criterion: distinct destinations require one query per kind/chunk; preserve unsupported URL,
  not-found, not-published and not-free results.

### F11. Consent evidence reads remain per evidence despite Promise.all

- Chain: [`recurring-consent.ts:28`](../../../apps/backend/src/modules/billing/shared/recurring-consent.ts#L28)
  and [`billing-payments.ts:223`](../../../apps/backend/src/modules/billing/facets/billing-payments/billing-payments.ts#L223)
  call `BillingContact.readConsent` per evidence reference.
  [`readConsent:115`](../../../apps/backend/src/modules/accounts/facets/billing-contact/billing-contact.ts#L115)
  uses `legalAcceptance.findFirst`, so this is not the compatible-`findUnique` batching case.
- Bound: subscription consent has at most four evidence references
  (`subscription-change.ts:55`). Low fixed fan-out compared with report/list findings.
- Direction: one owner-scoped read for Account and evidence-ID set, retaining payment-context
  requirements and distinct document validation. Prioritize only if traces show meaningful traffic.
- Criterion: one evidence-set query and unchanged absent/unavailable/valid results, including wrong
  Account, missing payment context and duplicate document kinds.

## Candidates requiring measurement or different treatment

1. **Parallel Prisma single-row owner calls.** `list-access-holders.ts:94` calls `readBinding`
   for each of at most 100 Accounts. `telegram-account-links.ts:53` and `:79` do the same before
   and after contact enrichment. `preview-grant-batch.ts:130` reads Account identities per row
   (maximum 100, schema at line 70). Owner calls fan out statically, but compatible parallel
   `findUnique` calls might share SQL through Prisma batching. Capture Prisma query events before
   claiming N physical statements. Preserve pre/post contact validation if introducing set reads.
   `apply-grant-batch.ts:113` performs the identity rechecks serially, making its read fan-out clear;
   its subsequent sorted locks and writes are stateful and must retain their ordering.
2. **Quadratic in-memory joins.** `list-access-holders.ts:97` filters all returned enrollments/grants
   per Account and calls `timed.find` per enrollment. `telegram-account-links.ts:90` filters contact
   results per Account. `CoverageCatalog.resolve:65` finds rows per requested item. Replace those
   with grouped Maps if representative CPU profiles justify it. The holder page is bounded at 100,
   but `readTimedEnrollmentAccess` reads all manual/course enrollments before pagination
   (`timed-enrollment-access.ts:15`). This is global-scan growth, not N+1: measure rows scanned and
   heap separately from query count.
3. **Repeated series continuation.** `get-learning-home.ts:100` probes at most ten series until a
   continuation is found. `get-series-continuation.ts:55` loads each series, performs batched
   availability, composition, state and visit reads. This is a bounded early-exit search, not per
   Material queries. Measure inspected series and duplicated Account facts before adding a new
   many-series seam. Existing 500-visit/100-Material batching should remain.
4. **Refresh/reconciliation workers.** `refresh-deliveries.ts:33` reads source/access/binding per
   at most 25 deliveries; candidates can share source or Account. Community effect/reconciliation
   workers (`community-provider.ts:728`, `:1723`), notification provider (`notification-provider.ts:175`),
   queue processors, and backend entitlement delivery use bounded loops around independently
   claimed jobs. Optimize repeated read-only facts only after measuring. Locks, generation checks,
   claims, state transitions and provider effects are not interchangeable with batch-all writes.
5. **Provider membership lookup.** `group-members-report.ts:45` issues `getChatMember` per candidate,
   after one bot prerequisite check. The helper has no internal candidate cap; caller policy owns it.
   This is inherent single-member provider work absent an available bulk contract. Measure candidate
   count, rate limits and latency; bounded concurrency or a valid observation snapshot are options,
   not a claim that SQL batching can remove the provider calls.
6. **Background cleanup and renewal.** Asset/avatar/cover/video cleanup, refund reconciliation,
   billing payment/subscription renewal and `renewal-schedule.ts:106` combine reads with per-item
   transactions/effects. `endLapsedSubscriptions:145` rechecks a subscription under its lock.
   Preloading may help selection, but it cannot replace the locked safety recheck. Keep proof of
   rollback, concurrency, idempotency and ambiguous provider effects when changing those paths.

## Existing batching worth retaining

- `assemble-content-access.ts:536` collects unique resources by kind, fetches resource sets and
  fetches owning Materials once. `checkAvailabilityMany` reads subject permission once. Its optional
  fallback at line 138 uses per-resource calls, but production `assemble-account-rights.ts:50`
  provides `resolveManyForAccess`; the fallback is not a confirmed production N+1.
- `resolve-membership-for-access.ts:82` reads Account capability facts once inside a snapshot and
  projects up to 100 resources in memory.
- `project-published-catalog-items.ts:121`, learning/chapter task lists, learning Material reads and
  artifact delivery split availability/directory requests into bounded chunks.
- `load-material-resumes.ts:26` reads video availability/progress as sets and joins through Maps.
- `telegram-account-links.ts:178` resolves identities in 5,000-ID chunks and rejects ambiguous links.
- `content-collection-persistence.ts:99` and `:195` list collections with grouped counts and bulk
  cover projections. They do not query counts/covers per collection.
- `funnel-timeline.ts:94` loads existing deliveries for enrollment batches before per-enrollment
  planning; `communication-state.ts:103` chunks bulk inputs at 1,000.
- Shared packages contain pure policy/rendering/catalog functions in the inspected source.
  Their loops do not own database or remote calls; changing them cannot remove the confirmed
  persistence fan-out above.

## Verification approach for subsequent fixes

Capture owning SQL statements and capability/provider calls for N = 1, 10, 100, plus each real
maximum where feasible. Seed outside the measurement window. Use query events against the real
application client, because mocked method-call counts cannot establish Prisma physical batching.
Report total reads, distinct repeated statements, rows returned, latency percentiles and heap.

A useful batching fix makes statement count constant per relation or proportional to chunks, while
preserving response shape/order, per-group limits, absent versus unavailable outcomes, coherent
snapshots and concurrency rechecks. Provider calls and required writes may still scale with N.
Do not claim an improvement from parallelizing N identical reads alone. No latency/traffic ranking
is asserted by this report; prioritize confirmed unbounded lists and high bounded query counts,
then validate with actual traffic and row distributions.
