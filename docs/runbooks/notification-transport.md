# Notifications transport

Platform #435 supplies the RabbitMQ transport, source outboxes and recoverable Notifications
inbox. It does not yet materialize audiences or send messages. Core/email processing belongs to
#436, first-publication integration to #437, Billing integration to #410 and Telegram processing
to Telegram #56. Pending inbox rows intentionally wait for those consumers. The accepted wire
contract remains [Notifications v1](../contracts/notifications-v1/protocol.md).

## Local operation

Follow [singleton Compose ownership](local-development.md#parallel-worktrees-and-singleton-ownership)
before running the repository stack. Normal `docker compose up --build` adds RabbitMQ and
`notifications-worker`. The RabbitMQ image generates a development-only self-signed TLS certificate
on first start, persists it with broker data and shares only its public certificate with the worker.
No AMQP or management port is published to the host. Local broker passwords are disposable fixture
values, never production credentials. `docker compose down` preserves both broker data and CA.

Topology is generated from `src/infrastructure/notification-transport/topology.ts` and the wire
route map. `pnpm --filter @inside/backend notifications:generate` regenerates the schema snapshot
and local definitions; `notifications:check` rejects drift. There are six topic exchanges and eight
quorum queues, with independent capacity and manual-ack prefetch per lane. Default capacity is
1,000 messages / 16 MiB per queue; overshoot at the broker's rejection boundary is possible.
`reject-publish`, persistent messages, mandatory returns and confirms retain unconfirmed work in
PostgreSQL. No TTL, alternate exchange, dead-letter drop or automatic delivery limit removes work.

The deployment boundary loads definitions at broker boot; application users cannot declare topology.
Each environment has its own vhost and five distinct principals: Billing, Materials, Notifications,
email and Telegram. Each can publish only to its named exchanges and consume only its queues.
The worker holds the four Platform identities separately; Telegram credentials never enter Platform.

The worker requires `NOTIFICATIONS_BROKER_URLS`, a JSON object with `billing`, `materials`,
`notifications`, `email` URLs. They must have distinct usernames and one non-default environment
vhost. `NOTIFICATIONS_BROKER_CA_FILE` optionally adds a private CA without disabling certificate or
hostname verification. Production requires AMQPS. `NOTIFICATIONS_PREFETCH` defaults to 4 (1–32)
and `NOTIFICATIONS_QUARANTINE_CAPACITY` to 1,000 (1–100,000). Configuration is parsed once into
`PlatformConfig.notifications`. No broker configuration is required by existing API/MCP processes.

## Persistence and integration seams

Billing and Materials own `notification_outbox` in their own schemas. Their local
`stageBillingNotification` / `stageMaterialsNotification` operation must be called with the
transaction already persisting the source fact; throwing rolls both back. No source event is emitted
by #435 alone. The process consumes their public relay facets, never queries their tables itself.
Notifications owns its command/email-result outbox, inbox and quarantine in schema `notifications`.

`stageNotification` validates the reviewed schema, normalizes UUID identifiers and binds publisher
scope + immutable message ID to the lane and canonical digest. A payload conflict throws rather
than replacing the first record. A relay selects due rows in source order and updates `publishedAt`
only after confirm without return. Failure persists bounded exponential retry (1–60 seconds) and
`lastFailure`; attempts do not change message IDs. An interrupted relay may publish duplicates.

The inbox row itself is the durable job, with `completedAt = null` and a checkpoint committed with
receipt. Core processing must transactionally update checkpoint/domain effects through its own
module. Scope + message ID uniqueness deduplicates replay; a different digest or lane enters
quarantine. Wire acceptance is not source authorization, freshness validation, result correlation
or provider success; #436/#437/#410 own those business checks before effects.

Each lane has an independent relay loop and consumer channel. Subscription saturation cannot
consume the material/result channel's prefetch or delay its publisher confirms. The worker acquires
the existing PostgreSQL generation lease and validates the exact migration registry before reporting
ready. On shutdown it removes readiness before cleanup, cancels consumers, drains active receipt writes
within the shared ten-second budget and closes broker/Prisma resources. Broker disconnect or receipt-storage failure removes readiness and stops the worker;
restart it after the dependency is restored. No nack/requeue hot loop acknowledges missing receipts.

## Observation and recovery

Inspect `docker compose logs notifications-worker rabbitmq`. Logs contain lane/reason, pending inbox
count/oldest timestamp and retained quarantine count; never message text, recipients or broker URLs.
Unconfirmed publication logs `operator_attention`; inbox work older than five minutes does likewise.
`publishedAt` is broker acceptance only. `completedAt` is application processing, never a sent receipt.

For an outage, restore the broker/PostgreSQL and restart only the owned `notifications-worker`.
Pending outbox rows retry with the same IDs; accepted pending inbox rows survive the restart. Do not
purge queues, reset volumes, delete deduplication keys or create replacement operation IDs.

Poison data is acknowledged only after quarantine commit. Quarantine serializes capacity admission
in PostgreSQL, stores the full digest and at most 16 KiB of base64 payload, and stops consumption if
capacity/storage is unavailable. Payload is removed after seven days by the running sweep; digest,
reason and deduplication receipts remain. Base64 is encoding, not encryption: PostgreSQL, backups
and operator access must protect this data. Export only the exact incident rows using restricted
DB access to an access-controlled artifact; never paste payloads into logs, issues or chat.

A row the application cannot process shares that fate without stopping anything else. Audience
expansion isolates one inbox row: a failure defers it for 30 seconds and counts the attempt in its
checkpoint, and the third failed attempt quarantines the payload under reason
`unprocessable_notification` and completes the row. The worker names the cause in its own log
(`row_retry`, `row_quarantined`, `inbox_sweep_failed`) and keeps running: before this, one such row
stopped every notification and kept stopping the process after each restart.

On quarantine exhaustion, stop the affected worker, export/inspect the bounded incident, resolve
its cause and expire retained payloads only after the approved retention/recovery decision. A replay
of the same digest reuses its evidence row. After a decoder/policy fix, an authorized redrive must
publish the original payload and original message ID through its original scoped publisher and
retain the quarantine receipt. A conflict cannot be fixed by renaming the ID. Business dispatch and
unknown-send recovery are #436/#56; this transport has no external send or operator resend endpoint.

## Verification and production boundary

`pnpm --filter @inside/backend exec vitest run --config vitest.integration.config.mts test/integration/notification-transport.test.ts`
uses disposable real PostgreSQL and a TLS RabbitMQ container. It covers ACL denials, source rollback,
concurrent inbox deduplication, SIGKILL before/after confirm and inbox/ack, mandatory return,
reject-publish backlog, quarantine capacity/retention and node stop/start recovery. No fake broker
is substituted. These tests run in the normal Integration CI job.

A local singleton loses availability when stopped. These tests prove durable recovery, **not HA**.
Production requires an explicitly approved broker rollout, separate environment credentials/TLS,
three quorum replicas in independent failure domains, disk/memory limits, monitoring and a real
single-node-loss drill with the remaining majority. Three containers on one host do not prove that.
Production Compose activation, credentials, deploy and real notifications are outside #435.

Transport settings do not yet activate a production worker in `compose.production.yaml`. The
compiled entrypoint is included in the backend image so the later rollout can use the same artifact.

Core, preferences, email effect ledger и операторские API описаны в [Notifications runbook](notifications.md).
