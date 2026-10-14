# Pagination audit

Date: 2026-10-14. Source head: `2b650e946af93d409a8d1518a2eda12b65247fed`.
Scope: production Web list consumers, Backend list/read-many owners, growing Telegram lists, and shared packages.
This is an evidence inventory for later decisions. No production changes were made.

## Method and limits

The audit traced consumers through transport to the owning query and continuation rule. A missing `take` alone is not a finding. Bounded ID lookups, programme compositions, recent-item panels, aggregates, and worker claims have different contracts from exhaustive lists. Serial traversal of a cursor is correct when each request depends on the preceding response.

Evidence is source inspection plus one deterministic execution of the actual catalog encoder body, with installed Zod validation. No production database, application browser, seeded PostgreSQL suite, or load benchmark was used. Findings labelled confirmed describe reachable source behavior; they do not claim the production dataset has crossed the stated threshold. Concurrency findings remain candidates unless the intended consistency contract is established.

## Confirmed findings

### PAG-01 — Accepted Unicode titles produce rejected title-sort cursors

**Impact:** High confidence correctness defect. A valid title can prevent the current page from rendering and prevent traversal to its successor.

Material metadata accepts up to 160 characters: [material-metadata.ts:80](../../../apps/backend/src/modules/materials/domain/material-metadata.ts#L80). The cursor contains the entire lowercased title, UUID, version, and query fingerprint; its encoder imposes no encoded-size limit: [list-published-materials.ts:278](../../../apps/backend/src/modules/content-library/features/list-published-materials/list-published-materials.ts#L278). The request accepts at most 512 characters: [list-published-materials.ts:29](../../../apps/backend/src/modules/content-library/features/list-published-materials/list-published-materials.ts#L29). The HTTP response and browser also constrain `nextCursor` to 512: [published-catalog-http.ts:46](../../../apps/backend/src/modules/content-library/shared/published-catalog-http.ts#L46), [library-catalog.browser.ts:36](../../../apps/web/src/features/library-catalog/api/library-catalog.browser.ts#L36).

**Deterministic reproduction executed:** Node extracted the `return` body of the source's `encodeCursor` function, then called that body with a title cursor and a valid 43-character fingerprint. UUID: `00000000-0000-4000-8000-000000000001`. Results:

| Title | UTF-16 length | UTF-8 bytes | Cursor characters | 512 limit |
| --- | ---: | ---: | ---: | --- |
| `"a".repeat(160)` | 160 | 160 | 422 | Accepted |
| `"я".repeat(160)` | 160 | 320 | 635 | Rejected |
| `"漢".repeat(160)` | 160 | 480 | 848 | Rejected |

Installed Zod confirmed `{ metadataAccepted: true, generatedCursorLength: 635, cursorAccepted: false }` for the Cyrillic case. This is the real encoder body, not an independently reimplemented size estimate. The title key comes from PostgreSQL `lower(publication.title)`: [published-material-projection.ts:455](../../../apps/backend/src/modules/materials/infrastructure/postgres/published-material-reader/published-material-projection.ts#L455).

Reproduce from the repository root:

```bash
node <<'NODE'
const fs = require('node:fs');
const { createRequire } = require('node:module');
const req = createRequire(process.cwd() + '/apps/backend/package.json');
const { z } = req('zod');
const path = 'apps/backend/src/modules/content-library/features/list-published-materials/list-published-materials.ts';
const source = fs.readFileSync(path, 'utf8');
const declaration = source.match(/function encodeCursor\([\s\S]*?\n\}/)[0];
const body = declaration.slice(declaration.indexOf('  return'), -1);
const encode = new Function('cursor', 'fingerprint', body);
const title = 'я'.repeat(160);
const cursor = encode({
  kind: 'title', materialId: '00000000-0000-4000-8000-000000000001', title,
}, 'a'.repeat(43));
console.log({
  metadataAccepted: z.string().trim().min(1).max(160).safeParse(title).success,
  generatedCursorLength: cursor.length,
  cursorAccepted: z.string().min(1).max(512).safeParse(cursor).success,
});
NODE
```

**Trigger:** A nonfinal title-sorted page ends with a sufficiently long Unicode title. Twelve items plus a successor suffice; a large catalog is unnecessary.

**Direction:** Reconcile accepted sort-key size and encoded cursor size across all boundaries.
**Verification criterion:** For accepted maximum-length multilingual titles, every generated continuation validates against both response and request contracts; following it visits every fixture once.

### PAG-02 — Sitemap traversal silently truncates at 1,200 materials

The public HTTP catalog fixes each page at **12**, not the application's maximum 24: [list-published-materials.controller.ts:41](../../../apps/backend/src/modules/content-library/features/list-published-materials/list-published-materials.controller.ts#L41), [same:187](../../../apps/backend/src/modules/content-library/features/list-published-materials/list-published-materials.controller.ts#L187). The sitemap reader stops after 100 pages and returns `kind: "ready"` even when the last response still has a cursor: [get-public-site-index.ts:27](../../../apps/web/src/features/public-site-index/api/get-public-site-index.ts#L27), [same:61](../../../apps/web/src/features/public-site-index/api/get-public-site-index.ts#L61), [same:79](../../../apps/web/src/features/public-site-index/api/get-public-site-index.ts#L79).

**Trigger/consequence:** At 1,201 published materials, older materials disappear from this index without an incomplete-result signal. The separate 50,000-material guard never determines the current threshold.
**Direction:** Give complete index traversal an explicit exhaustion/completion contract; retain a cycle/budget guard without treating budget exhaustion as successful traversal completion.
**Verification criterion:** A valid available 1,201-item fixture completes successfully and includes item 1,201. Upstream failures and invalid continuations stay explicit failures. A repeated cursor cannot loop indefinitely. Follow #1466 for output partitioning and sitemap limits.

### PAG-03 — Empty projected bookmark pages hide valid later pages

The Backend pages raw bookmarks, then omits rows without a published projection. It calculates continuation from the raw page: [list-bookmarks.ts:60](../../../apps/backend/src/modules/bookmarks/features/list-bookmarks/list-bookmarks.ts#L60), [same:76](../../../apps/backend/src/modules/bookmarks/features/list-bookmarks/list-bookmarks.ts#L76), [same:87](../../../apps/backend/src/modules/bookmarks/features/list-bookmarks/list-bookmarks.ts#L87). Selection reads published projections, so a retained bookmark for an unpublished material can be absent: [select-published-materials.ts:28](../../../apps/backend/src/modules/materials/features/select-published-materials/select-published-materials.ts#L28), [published-material-projection.ts:749](../../../apps/backend/src/modules/materials/infrastructure/postgres/published-material-reader/published-material-projection.ts#L749). Existing integration source explicitly confirms retained, hidden unpublished bookmarks: [bookmarks.test.ts:280](../../../apps/backend/test/integration/bookmarks.test.ts#L280).

The Web preserves that cursor in query options but returns `BookmarksEmpty` whenever accumulated visible items are empty, before rendering load-more: [bookmarks-page-query.client.tsx:22](../../../apps/web/src/_pages/bookmarks/ui/bookmarks-page-query.client.tsx#L22), [same:42](../../../apps/web/src/_pages/bookmarks/ui/bookmarks-page-query.client.tsx#L42), [same:56](../../../apps/web/src/_pages/bookmarks/ui/bookmarks-page-query.client.tsx#L56).

**Trigger/consequence:** A first raw page consists entirely of unpublished bookmarks while an older published bookmark exists. The UI claims emptiness and offers no path to that older bookmark.
**Direction:** Distinguish projected page emptiness from exhausted traversal.
**Verification criterion:** With one full first page of unpublished bookmarks and one older published bookmark, the person can reach the published bookmark; the initial state does not claim final emptiness.

### PAG-04 — Failed bookmark continuation is accepted as end-of-list

The browser adapter converts nonready reads and invalid bodies to resolved `{ kind: "unavailable" }` values: [bookmarks.browser.ts:80](../../../apps/web/src/features/bookmarks/api/bookmarks.browser.ts#L80). The query's continuation function returns no cursor for these values. The UI checks only the first page for unavailability and filters later failures out of the visible item array: [bookmarks-page-query.client.tsx:22](../../../apps/web/src/_pages/bookmarks/ui/bookmarks-page-query.client.tsx#L22), [same:35](../../../apps/web/src/_pages/bookmarks/ui/bookmarks-page-query.client.tsx#L35), [same:39](../../../apps/web/src/_pages/bookmarks/ui/bookmarks-page-query.client.tsx#L39).

**Trigger/consequence:** Page one succeeds and page two receives a temporary dependency failure. Existing cards remain, but load-more disappears without a failure/retry affordance. A later authentication failure is similarly hidden on this path.
**Direction:** Preserve the failed continuation as retryable rather than committing it as an exhausted page.
**Verification criterion:** After a failed second read, page one remains visible, the failure is exposed, and retry requests the same cursor and appends page two exactly once.

### PAG-05 — Owner billing lists drop available continuation

The server loader requests `offers.list` with limit 100, then returns only `items`: [billing-admin.server.ts:379](../../../apps/web/src/features/billing-admin/api/billing-admin.server.ts#L379), [same:387](../../../apps/web/src/features/billing-admin/api/billing-admin.server.ts#L387), [same:393](../../../apps/web/src/features/billing-admin/api/billing-admin.server.ts#L393). Backend forwards `nextCursor`: [billing-operations.ts:705](../../../apps/backend/src/modules/billing/facets/billing-operations/billing-operations.ts#L705). The People assignment selector separately requests only the first 100 `tiers.list` rows and discards its cursor: [people-panel.client.tsx:101](../../../apps/web/src/features/billing-admin/ui/people-panel.client.tsx#L101). Backend tiers correctly fetch limit+1 and continue from the last raw displayed row: [billing-operations.ts:529](../../../apps/backend/src/modules/billing/facets/billing-operations/billing-operations.ts#L529), [same:568](../../../apps/backend/src/modules/billing/facets/billing-operations/billing-operations.ts#L568).

**Trigger/consequence:** More than 100 matching catalog rows hide later payment options in the owner catalog or later assignable tiers in People. The offers cursor belongs to payment-option rows, so this is not necessarily 100 distinct Offers. Filtering the first tier page for assignability can produce an empty selector even when later assignable tiers exist.
**Direction:** Keep complete selectors complete, or expose paginated selection; do not discard a server-provided cursor.
**Verification criterion:** A row beyond position 100 is reachable in each surface; a fixture with only later assignable tiers still offers a valid assignment choice.

### PAG-06 — Learner submission history silently loses older attempts

The history query accepts only a task code and takes the newest 50 submissions with no continuation or truncation field: [list-task-submissions.ts:28](../../../apps/backend/src/modules/product-tasks/features/list-task-submissions/list-task-submissions.ts#L28), [same:30](../../../apps/backend/src/modules/product-tasks/features/list-task-submissions/list-task-submissions.ts#L30), [same:106](../../../apps/backend/src/modules/product-tasks/features/list-task-submissions/list-task-submissions.ts#L106). The production UI renders this array as the learner's submission history and says attempts are unlimited and previous submissions remain: [product-task-view.tsx:710](../../../apps/web/src/_pages/product-task/ui/product-task-view.tsx#L710), [same:718](../../../apps/web/src/_pages/product-task/ui/product-task-view.tsx#L718).

**Trigger/consequence:** Attempt 51 hides the oldest attempt and its feedback from this learner history. Persistence remains; this is read reachability loss, not data deletion.
**Direction:** Make older attempt history reachable, or explicitly establish and communicate a recent-50 contract.
**Verification criterion:** For 51 attempts, the person can read the oldest attempt and feedback, or receives an explicit agreed truncation state.

### PAG-07 — Paginated author submissions fail at 101 Products with Tasks

Every author-submission request first loads **all** Tasks and passes all distinct Product IDs in one directory call before applying request filters: [list-author-submissions.ts:170](../../../apps/backend/src/modules/product-tasks/features/list-author-submissions/list-author-submissions.ts#L170), [same:181](../../../apps/backend/src/modules/product-tasks/features/list-author-submissions/list-author-submissions.ts#L181). The actual directory owner rejects more than 100 IDs: [read-product-directory.ts:12](../../../apps/backend/src/modules/materials/features/read-product-directory/read-product-directory.ts#L12), [same:71](../../../apps/backend/src/modules/materials/features/read-product-directory/read-product-directory.ts#L71).

**Trigger/consequence:** Tasks exist in 101 distinct Products. All author-submission pages fail through the catch boundary, including a query restricted to one Product or one submission. The submission SQL page itself remains correctly bounded.
**Direction:** Respect the bounded directory interface and separate page enrichment from whole-catalog filter discovery.
**Verification criterion:** With Tasks in 101 Products, a one-Product query and a continuation query return correct pages; no directory invocation exceeds its bound.

### PAG-08 — People pagination still materializes growing global histories

Before selecting one bounded People page, Account Rights loads every manual/course enrollment, including old rows, and every grant for timed enrollments: [timed-enrollment-access.ts:14](../../../apps/backend/src/modules/account-rights/shared/timed-enrollment-access.ts#L14), [same:21](../../../apps/backend/src/modules/account-rights/shared/timed-enrollment-access.ts#L21). `listAccessHolders` performs that read on every page and builds inclusion/exclusion ID lists from it: [list-access-holders.ts:55](../../../apps/backend/src/modules/account-rights/features/list-access-holders/list-access-holders.ts#L55), [same:146](../../../apps/backend/src/modules/account-rights/features/list-access-holders/list-access-holders.ts#L146). An Offer filter additionally fetches every confirmed one-time purchase for that Offer before entering pagination: [read-access-roster.ts:43](../../../apps/backend/src/modules/billing/features/read-access-roster/read-access-roster.ts#L43).

**Confirmed property:** Query output and in-process work grow with global historical enrollment/purchase counts, despite the People page limit. SQL index scans alone are not the concern; these queries return the complete histories into application memory.
**Scale condition/consequence:** Long-lived enrollment and purchase histories increase repeated allocations, large ID predicates, and request cost for each page. No latency threshold or production slowdown was measured.
**Direction:** Keep the effective-rights and Offer filtering semantics while applying them before bounded account selection without materializing complete histories per request.
**Verification criterion:** For a fixed People page size and equivalent active population, growing expired/unrelated histories does not proportionally increase application-returned rows or allocations; resulting account IDs match current semantics.

## Candidates and explicit scale limits requiring a product decision

These are not asserted to need cursor pagination automatically.

1. **Whole learning-task catalog silently caps at 500.** [list-learning-tasks.ts:16](../../../apps/backend/src/modules/product-tasks/features/list-learning-tasks/list-learning-tasks.ts#L16), [same:63](../../../apps/backend/src/modules/product-tasks/features/list-learning-tasks/list-learning-tasks.ts#L63). The cap occurs before personal access filtering and final Product/chapter sorting. At 501 published Tasks, omitted accessible Tasks can exist; inaccessible early rows can suppress visible later Tasks. The import contract permits positions through 1,000 and imposes no aggregate catalog cap: [import-product-task.contract.ts:30](../../../apps/backend/src/modules/product-tasks/features/import-product-task/import-product-task.contract.ts#L30). Establish whether the surface is a complete catalog or intentionally bounded recent/selected data. Criterion: a fixture with 500 closed Tasks followed by an accessible Task produces a truthful result.
2. **Single-Product programme Tasks cap at 500.** [list-chapter-tasks.ts:16](../../../apps/backend/src/modules/product-tasks/features/list-chapter-tasks/list-chapter-tasks.ts#L16), [same:61](../../../apps/backend/src/modules/product-tasks/features/list-chapter-tasks/list-chapter-tasks.ts#L61). This is a whole programme composition, not an ordinary infinite feed. Decide whether a 500-Task Product is a supported authoring limit; enforce and report that limit or preserve complete composition. Criterion: a 501-Task Product cannot silently publish an incomplete programme.
3. **Public cohorts cap at 100 without an exhaustion flag.** [list-product-cohorts.ts:8](../../../apps/backend/src/modules/billing/features/list-product-cohorts/list-product-cohorts.ts#L8), [same:25](../../../apps/backend/src/modules/billing/features/list-product-cohorts/list-product-cohorts.ts#L25). A one-Product Web read currently finds its Product in this global first page: [billing-catalog.server.ts:111](../../../apps/web/src/entities/subscription/api/billing-catalog.server.ts#L111). At 101 cohort rows, a later Product can appear to have no cohort. Decide a catalog bound or direct scoped-read contract. Criterion: a Product beyond position 100 retains its cohort state.
4. **Author collection administration and reference selectors are complete unbounded catalogs.** [content-collection-persistence.ts:100](../../../apps/backend/src/modules/materials/infrastructure/postgres/content-collection-persistence.ts#L100), [same:196](../../../apps/backend/src/modules/materials/infrastructure/postgres/content-collection-persistence.ts#L196), [list-authoring-references.ts:32](../../../apps/backend/src/modules/materials/features/list-authoring-references/list-authoring-references.ts#L32). Collection administration is a real growing list; reference selectors need complete choices or scoped search. No present size or response-time problem was measured. Criterion: measure response bytes and render/query cost at the agreed catalog size before choosing list pagination versus searchable selectors.
5. **Catalog metadata remains whole-catalog work on every page.** [published-material-projection.ts:606](../../../apps/backend/src/modules/materials/infrastructure/postgres/published-material-reader/published-material-projection.ts#L606). Counts/facet arrays are intentional filter metadata; serial cursor traversal is not itself a defect. Benchmark repeated facets and counts for sitemap and interactive pagination. Criterion: record database time and returned facet bytes per page at realistic catalog cardinalities before changing cache/metadata ownership.
6. **Recent-only histories need explicit scope, not automatic infinite scrolling.** Own payments take 50: [billing-payments.ts:72](../../../apps/backend/src/modules/billing/facets/billing-payments/billing-payments.ts#L72), [same:609](../../../apps/backend/src/modules/billing/facets/billing-payments/billing-payments.ts#L609). Cabinet notices take 20: [billing-notices.ts:65](../../../apps/backend/src/modules/billing/facets/billing-notices/billing-notices.ts#L65), [same:259](../../../apps/backend/src/modules/billing/facets/billing-notices/billing-notices.ts#L259). Payment detail takes the first 100 owner-audit commands while events/refund decisions are complete per-purchase arrays: [read-payments.ts:190](../../../apps/backend/src/modules/billing/features/read-payments/read-payments.ts#L190), [same:92](../../../apps/backend/src/modules/billing/features/read-payments/read-payments.ts#L92). Establish whether each UI promises a recent panel or complete history; verify boundary fixtures against that promise.

## Coverage inventory and strong patterns

| Production family inspected | Current shape and assessment | Owning sources |
| --- | --- | --- |
| Public Library, Topic catalog, Home feed | Bounded 12-item HTTP pages; newest/relevance/series/title keysets include UUID tie-breakers. Normalized filter/search fingerprint binds catalog cursors. Title encoding has PAG-01. | [catalog query:122](../../../apps/backend/src/modules/content-library/features/list-published-materials/list-published-materials.ts#L122), [SQL continuation/order:554](../../../apps/backend/src/modules/materials/infrastructure/postgres/published-material-reader/published-material-projection.ts#L554) |
| Catalog Web loading | One query key contains filter identity and feed scope; filter changes clear the cursor. Load-next checks in-flight state. Transport errors throw; existing cards have a continuation-failure path. | [query keys:13](../../../apps/web/src/features/library-catalog/model/library-catalog-query.ts#L13), [hook:64](../../../apps/web/src/features/library-catalog/model/use-library-catalog-query.client.ts#L64), [Home:137](../../../apps/web/src/_pages/home/ui/home-feed.client.tsx#L137) |
| Author Material list | Bounded offset page with `updatedAt, id` order, count and total pages. Static-row ties are deterministic. Concurrent edits can move rows across offset pages; no snapshot guarantee was established. | [list-materials.ts:66](../../../apps/backend/src/modules/materials/features/list-materials/list-materials.ts#L66) |
| Bookmarks | Correct `bookmarkedAt, materialId` descending keyset and raw-row continuation. Account scope is reapplied to every query. Web empty/error integration has PAG-03/04. | [list-bookmarks.ts:45](../../../apps/backend/src/modules/bookmarks/features/list-bookmarks/list-bookmarks.ts#L45) |
| Author task submissions | Correct `submittedAt, id` descending keyset, limit+1, bounded page-specific versions/names. Cursor contains values, so deleting its source row does not invalidate the position. Global filter discovery has PAG-07. | [list-author-submissions.ts:200](../../../apps/backend/src/modules/product-tasks/features/list-author-submissions/list-author-submissions.ts#L200) |
| Learner Tasks and submissions | Access reads batch at 100. Chapter Tasks are composition; whole catalog cap and attempt-history loss require the distinctions above. | [list-learning-tasks.ts:75](../../../apps/backend/src/modules/product-tasks/features/list-learning-tasks/list-learning-tasks.ts#L75), [list-task-submissions.ts:106](../../../apps/backend/src/modules/product-tasks/features/list-task-submissions/list-task-submissions.ts#L106) |
| Payments owner list | ID cursor resolves immutable `createdAt`; query uses matching `createdAt, id` tuple and limit+1. Unknown cursor explicitly fails rather than restarting. | [read-payments.ts:128](../../../apps/backend/src/modules/billing/features/read-payments/read-payments.ts#L128) |
| People roster and Invitations | People merges bounded sorted distinct-account pages from two sources; unique account is the tie-breaker. Invitations resolves ID to `issuedAt, id`, matching its order. Both Web lists use infinite queries and throw failed operations. Outer page boundaries are sound; PAG-08 concerns hidden prerequisite work. | [list-access-holders.ts:53](../../../apps/backend/src/modules/account-rights/features/list-access-holders/list-access-holders.ts#L53), [manage-invitations.ts:140](../../../apps/backend/src/modules/account-rights/features/manage-invitations/manage-invitations.ts#L140), [people-panel.client.tsx:84](../../../apps/web/src/features/billing-admin/ui/people-panel.client.tsx#L84), [invitations-panel.client.tsx:74](../../../apps/web/src/features/billing-admin/ui/invitations-panel.client.tsx#L74) |
| Billing public offers | Unique payment-option ID keyset; cursor advances from raw rows even when pricing/admission removes items. Web deliberately reads subsequent empty pages until completion. Budget exhaustion returns unavailable instead of partial success. | [list-offers.ts:90](../../../apps/backend/src/modules/billing/features/list-offers/list-offers.ts#L90), [billing-catalog.server.ts:41](../../../apps/web/src/entities/subscription/api/billing-catalog.server.ts#L41) |
| Product compositions and ID selection | Complete programme structure is intentionally separate from infinite feeds. Materials composition checks a 10,000-placement bound; selection/directory interfaces validate at most 100 IDs. Do not add pagination to bounded lookup interfaces. | [product-composition.ts:8](../../../apps/backend/src/modules/materials/shared/product-composition.ts#L8), [same:113](../../../apps/backend/src/modules/materials/shared/product-composition.ts#L113), [select-published-materials.ts:22](../../../apps/backend/src/modules/materials/features/select-published-materials/select-published-materials.ts#L22) |
| Telegram templates, funnels, broadcasts, deliveries | Unique UUID ascending keysets, owner/bot predicates reapplied, limit+1 and last displayed raw-row cursor. Web communications surfaces expose next-page controls. No static-dataset duplicate/gap defect confirmed. | [communications.ts:52](../../../apps/telegram/src/modules/communications/communications.ts#L52), [broadcasts.ts:56](../../../apps/telegram/src/modules/communications/broadcasts.ts#L56), [funnels.ts:221](../../../apps/telegram/src/modules/communications/funnels.ts#L221), [same:256](../../../apps/telegram/src/modules/communications/funnels.ts#L256), [communications-page.client.tsx:156](../../../apps/web/src/_pages/communications/ui/communications-page.client.tsx#L156) |
| Telegram author drafts | Saved/draft IDs are unioned and deduplicated before one order/limit. Both sides receive the same strict cursor predicate; 10-item display and 11-row lookahead agree. | [author-funnel-drafts.ts:22](../../../apps/telegram/src/modules/communications/author-funnel-drafts.ts#L22), [author-broadcast-drafts.ts:46](../../../apps/telegram/src/modules/communications/author-broadcast-drafts.ts#L46) |
| Telegram contacts and entry history | Contacts use unique ID and 100+1. Entries use `entered_at, update_id` matching predicate/order; update ID is unique within the bot scope. Contact and entry continuations are exposed separately. A contact statistics page can perform 300 subsidiary queries; this is a batching/performance concern, not missing pagination. | [communication-statistics.ts:103](../../../apps/telegram/src/modules/communications/communication-statistics.ts#L103), [same:264](../../../apps/telegram/src/modules/communications/communication-statistics.ts#L264), [schema primary key:43](../../../apps/telegram/src/database/migrations/011-communication-funnels.ts#L43), [analytics-panel.tsx:154](../../../apps/web/src/_pages/communications/ui/analytics-panel.tsx#L154) |
| Background queues and delivery reconciliation | Bounded due/claim batches are work selection, not exhaustive human lists. Repeated invocations change due state; lack of cursor is not automatically a traversal defect. Representative Telegram and Backend reads inspected. | [community-provider.ts:718](../../../apps/telegram/src/modules/community/community-provider.ts#L718), [notification-provider.ts:163](../../../apps/telegram/src/modules/notifications/notification-provider.ts#L163), [read-deliveries.ts:39](../../../apps/backend/src/modules/notifications/features/read-deliveries/read-deliveries.ts#L39), [billing-payments.ts:729](../../../apps/backend/src/modules/billing/facets/billing-payments/billing-payments.ts#L729) |
| Shared packages | `packages/legal`, `material-blocks`, `access-capabilities`, and `runtime-identity` contain no production list-pagination/cursor codec found by source inventory. Cursor ownership currently lives in application slices. | [packages directory](../../../packages) |

## Cursor scope and mutation limits

Catalog cursors bind normalized filters and sort by fingerprint. Bookmark and author-submission cursors carry position values without an account/filter fingerprint, but their queries reapply account/authorization/filter constraints. Owner payment/invitation cursors resolve an existing ID and reapply current filters. Telegram cursors reapply owner and bot predicates. Cross-filter reuse can yield a partial logical list; it did not establish cross-scope data exposure in inspected paths.

Changing filters resets continuation in the inspected catalog and People UI. A stricter rule rejecting every cross-filter cursor is a product/API contract decision rather than a confirmed current defect. Criterion for that decision: reuse a cursor with changed filters and assert either explicit rejection or a documented position-based continuation.

Tie-breakers solve equal-sort-key ambiguity; they do not freeze mutable sort keys. Republishing Materials, changing titles/relevance, editing offset-sorted Materials, adding random UUID rows before an ID cursor, and changing rights while paging can change membership between requests. No snapshot guarantee was found or assumed. A future requirement for exact snapshot traversal needs separate evidence and design; this audit does not claim current keyset lists provide snapshots.

## Verification performed

- Read root and application `AGENTS.md`, root/application coding standards, `WORKFLOW.md`, and the assigned research skill.
- Traced production consumers and query owners listed above; inspected existing bookmark pagination integration source without running it.
- Executed the actual catalog cursor encoder body with ASCII, Cyrillic, and CJK fixtures; checked the Cyrillic fixture using installed Zod.
- Wrote only this report. No application tests, CI, Compose, database changes, commits, publishing, or deployment were performed.
- Coverage is broad but not exhaustive: embedded aggregate arrays, all MCP-only list consumers, and every queue's fairness/starvation behavior were not fully audited. Production cardinalities and response budgets remain unmeasured.
