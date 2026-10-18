# Telegram coding standards

Reviewers apply the [repository standards](../../CODING_STANDARDS.md), including
[deterministic test contracts](../../CODING_STANDARDS.md#deterministic-test-contracts-1153).
Application ownership and required checks remain in [AGENTS.md](AGENTS.md).

## Test review

Apply root [waiting rules](../../CODING_STANDARDS.md#waiting-in-tests). Telegram cases share a fixed
instant or virtual `CLOCK` between fixtures and consumers. Finite corpus grants retain their intended
valid/expired state after their literal expiry passes. Observe committed inbox rows, delivery, queue
drain or reported worker outcomes. Root contracts own common isolation, setup and cleanup requirements.
Legacy scenario isolation and process-suite separation remain tracked in #1154.

## Table ownership

A module reads and writes its own tables. A caller passes its transaction to an operation owned by
another module when both changes must commit together. `database/` owns schema declarations,
migrations and retention, rather than product decisions.

[Architecture checks](scripts/check-architecture.mjs) own the executable table-to-module inventory,
including inherited `DatabaseSchema` storage interfaces. Storage declarations do not transfer runtime
ownership. Review aliases, dynamic names and indirect access: literal-name checks do not prove those
boundaries. Negative CLI fixtures reject direct foreign access, including former legacy exceptions.

Collection enrichment uses owner-scoped set reads, bounded by the supported page or explicit chunks. An already authorized author list reads its saved rows and drafts directly through its owner; it does not replay single-item commands or acquire mutation/scheduler locks per item. Dispatch, mutation and authoritative synchronization retain their own authorization and locking checks.

There are no legacy foreign-table exceptions. CLI fixtures retain the former file/table pairs and
reject every direct access in them. Owner read queries may compose into the caller's SQL statement;
owner writes execute on the caller's transaction. `src/application/` wires contact and linking
effects without introducing module cycles. `src/app.module.ts` injects these effects and sign-in
reply eligibility. Product modules never import this composition layer.
