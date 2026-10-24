---
status: accepted
---

# Opaque transaction handoff between state owners

The owner accepted this direction on 2026-10-22 in the
[architecture findings assigned to the domain refactoring](https://github.com/sachkov-inside/platform/issues/1666#issuecomment-6340292604).
Callers pass an opaque branded transaction handle; only the receiving
Module unwraps it into its own capability-scoped Prisma client. Its operation performs permission,
identity and state checks in that same transaction, either joining a supplied transaction or owning
one standalone. Paired prepare/apply interfaces and foreign delegates exposed to callers are retired.

This preserves atomic rollback and the bounded connection pool while removing the duplicated
delegate lists that made ownership changes expensive. The brand carries no behaviour and is not
a generic repository or Unit of Work wrapper prohibited by ADR 0005. Unwrapping stays inside each
owner's persistence implementation; caller-visible types cannot access another owner's tables.
The alternative of an independent transaction per Module breaks rollback; exposing all delegates
preserves atomicity but spreads persistence knowledge and permits ownership mistakes.

`transactionHandle(tx)` creates an opaque capability backed by a process-local WeakMap. The
receiving owner calls `unwrapTransaction` only from its persistence implementation, narrowing to
its own scoped Prisma client. Invalid or forged handles are rejected. The handle exposes no
delegates and carries no transaction lifecycle methods. Joined unexpected failures propagate to
the caller so its transaction rolls back. Architecture checks derive delegate ownership from
the Prisma schema and reject foreign operations and unwrapping outside owner persistence.
Negative type fixtures and real PostgreSQL tests prove the boundary, joined rollback and standalone
execution; no handoff delegate allowlist remains.
External provider operations continue to use durable messages and recovery, not this handle.
