# Audit findings and coding standards

Date: 2026-10-14. Scope: all 43 records in the
[audit](../2026-10-14-data-flow-performance-audit.md) and
[implementation specification #1466](https://github.com/sachkov-inside/platform/issues/1466).

Concrete defects, triggers and measurements belong to the audit and specification.
Coding standards own reusable implementation rules. A candidate remains conditional;
mapping it to a rule does not establish a violation or measured performance impact.
The standards amendments in this worktree are prepared changes until integrated.

## Rule owners

| Reference | Authority |
| --- | --- |
| Collections | [Root: collection reads and pagination](../../../CODING_STANDARDS.md#collection-reads-and-pagination) |
| Ownership | [Root: repository-wide rules](../../../CODING_STANDARDS.md#repository-wide-rules) |
| Persistence | [Backend: Prisma, PostgreSQL, and migrations](../../../apps/backend/CODING_STANDARDS.md#prisma-postgresql-and-migrations) |
| Backend batches | [Backend: REST and authentication](../../../apps/backend/CODING_STANDARDS.md#rest-and-authentication) |
| Cache isolation | [Web: navigation and caching](../../../apps/web/CODING_STANDARDS.md#navigation-and-caching) |
| Server state | [Web: server state and mutations](../../../apps/web/CODING_STANDARDS.md#server-state-and-mutations) |
| Effects | [Web: effects and asynchronous synchronization](../../../apps/web/CODING_STANDARDS.md#effects-and-asynchronous-synchronization) |
| Telegram boundaries | [Telegram: application instructions](../../../apps/telegram/AGENTS.md), [table ownership](../../../apps/telegram/CODING_STANDARDS.md#table-ownership) |

## Complete record coverage

| Record | Applicable rules | Required review focus |
| --- | --- | --- |
| FLOW-01 | Server state | Render the permitted body independently of auxiliary Practice data. |
| FLOW-02 | Backend batches, Persistence | Read needed rights facts; preserve future grants, expiry and snapshot semantics. |
| FLOW-03 | Effects, Cache isolation | Measure actual duplicate requests before changing course orchestration. |
| FLOW-04 | Cache isolation, Backend batches | Preserve fresh personalized offer facts when assessing the second read. |
| FLOW-05 | Collections, Backend batches | Read product-membership facts as a set for the no-context locked-material path. |
| EF-1 | Effects | Serialize reconciliation polls and reject responses from obsolete resources. |
| EF-2 | Effects | Remove the unused callback synchronization after checking consumers. |
| EF-3 | Effects | Remove redundant draft-ref synchronization without changing editor behavior. |
| PAG-01 | Collections | Accepted multilingual titles generate accepted cursors with stable tie-breakers. |
| PAG-02 | Collections | Complete sitemap traversal; expose failures and respect sitemap output limits. |
| PAG-03 | Collections, Server state | Continue bookmarks through pages with no visible projected items. |
| PAG-04 | Collections, Server state | Preserve and retry a failed bookmark continuation. |
| PAG-05 | Collections | Traverse all eligible payment options and tiers without limiting before filtering. |
| PAG-06 | Collections | Expose older payment attempts through continuation or an agreed recent-window contract. |
| PAG-07 | Collections | Bound Product prerequisites without losing supported author-submission results. |
| PAG-08 | Collections | Bound People eligibility prerequisites as well as its output page. |
| N1 | Collections, Backend batches | Batch option pricing and promotion facts; preserve purchase-capacity checks. |
| N2 | Collections, Backend batches | Batch enrollment projections and bound outer reads. |
| N3 | Collections, Backend batches, Persistence | Batch Practice snapshots and access reads; preserve two-phase validation. |
| N4 | Collections, Telegram boundaries | Aggregate contact-entry statistics through the owning module. |
| N5 | Collections, Telegram boundaries | Batch author-list reads while preserving replay, authorization and lock behavior. |
| N6 | Collections, Telegram boundaries | Batch link reads around bounded scalar provider calls; keep revalidation. |
| N7 | Collections, Backend batches | Resolve many-Account rights facts in bounded sets with correct per-Account decisions. |
| N8 | Collections, Persistence | Share audience facts per checkpoint; preserve dispatch-time safety checks. |
| N9 | Collections, Backend batches | Batch asset presentations across referenced Material groups. |
| N10 | Collections, Ownership | Validate destination targets through owner-scoped sets. |
| N11 | Collections | Assess the bounded consent set separately from high-cardinality chains. |
| EC-1 | Effects, Server state | Measure repeated fact-channel subscriptions before consolidating their owner. |
| EC-2 | Effects | Preserve draft-feedback revision synchronization unless evidence permits removal. |
| EC-3 | Effects | Measure hydration-dependent image discovery before changing responsive behavior. |
| EC-4 | Effects, Cache isolation | Measure delayed home prefetch with fresh-query and intent behavior preserved. |
| PC-1 | Collections | Reconcile Task catalog limits with access filtering and supported traversal. |
| PC-2 | Collections | Document and enforce chapter composition bounds at the owning boundary. |
| PC-3 | Collections | Replace capped global Cohort scans with an owner-scoped lookup when supported. |
| PC-4 | Collections | Measure complete selectors before selecting search, pagination or bounded composition. |
| PC-5 | Collections | Measure repeated facet counts independently from page retrieval. |
| PC-6 | Collections | Establish complete versus recent-window history contracts before changing them. |
| BC-1 | Collections, Backend batches | Count SQL statements for compatible Prisma reads before declaring N+1. |
| BC-2 | Collections | Measure in-memory joins and bound global timed-enrollment prerequisites. |
| BC-3 | Collections | Measure bounded series continuation; preserve early exit. |
| BC-4 | Collections, Persistence | Share worker reads only within valid claim and lock lifetimes. |
| BC-5 | Collections, Telegram boundaries | Preserve scalar provider calls when the provider has no bulk contract. |
| BC-6 | Collections, Persistence | Preserve cleanup/renewal locks and ordered effects when assessing read sharing. |

## Implementation and review handoff

Apply root standards and the standard nearest to each changed surface. Telegram
already inherits the shared rules through the root router; it needs no duplicate
batching contract. Keep personal cache isolation in its existing Web authority.

For implementation, record each record's disposition and supporting evidence in
#1466. Use `implemented`, `already satisfied`, or `retained with evidence` as that
specification requires. Candidate measurements can justify retaining current code.

Follow [WORKFLOW.md](../../../WORKFLOW.md#review-before-integration) before integration.
Pass the immutable diff, assignment and applicable standards to the two reviewers.
The Standards reviewer checks documented rules. The Spec reviewer checks #1466's
requirements and every record's disposition. This is a diff review, not a fresh
whole-repository audit. Passing lint does not prove authorization, batch counts or
complete traversal.
