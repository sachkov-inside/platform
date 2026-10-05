---
status: accepted
---

# Project Telegram Membership events into PostgreSQL and reconcile outside reads

> Решение перенесено из [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/adr/0002-project-telegram-membership-events-into-postgresql.md).
> Область действия и текущий статус указаны в [индексе](README.md).

Platform answers Membership checks only from its local bounded PostgreSQL projection. Telegram
member-status events update that projection promptly through normalized evidence, while a
background reconciler checks known linked identities and repairs missed updates; user-facing
Library and Material reads never call Telegram. This accepts a revocation delay of at most five
minutes and fail-closed access when reconciliation falls behind in exchange for predictable read
latency, no provider dependency on the content path, and recovery after event-delivery gaps.

## Considered options

Request-triggered refresh couples content latency and availability to Telegram. Events without
reconciliation are simpler but a missed update can leave access incorrect indefinitely. Event-fed
projection plus reconciliation keeps the read path local while bounding both stale positive state
and recovery work.
