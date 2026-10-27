import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { dependencyFailure } from "./observability/dependency-failure.js";

import { runtimeIdentitySchema } from "@inside/runtime-identity";
import { context, ROOT_CONTEXT } from "@opentelemetry/api";
import { z } from "zod";

import { jobQueues } from "./job-queues.js";
import { Prisma } from "./prisma/generated/client.js";
import type {
  PlatformPrisma,
  TransactionClient,
} from "./prisma/prisma-client.js";
import type { RuntimeIdentity } from "./runtime-identity.js";

const queueSchema = z.enum(Object.values(jobQueues));
const workerSchema = z.enum([
  "billing-worker",
  "material-assets-worker",
  "profile-avatars-worker",
  "video-deletions-worker",
]);
const workers: Record<
  z.infer<typeof queueSchema>,
  z.infer<typeof workerSchema>
> = {
  [jobQueues.activityRetention]: "billing-worker",
  [jobQueues.telemetryRetention]: "billing-worker",
  [jobQueues.paymentRecovery]: "billing-worker",
  [jobQueues.subscriptionRenewal]: "billing-worker",
  [jobQueues.subscriptionNotices]: "billing-worker",
  [jobQueues.tributeReconciliation]: "billing-worker",
  [jobQueues.communityDelivery]: "billing-worker",
  [jobQueues.materialAssets]: "material-assets-worker",
  [jobQueues.profileAvatars]: "profile-avatars-worker",
  [jobQueues.videoDeletions]: "video-deletions-worker",
};
const attemptsSchema = z
  .array(
    z.object({
      id: z.uuid().toLowerCase(),
      retryCount: z.number().int().nonnegative().max(2_147_483_647),
    }),
  )
  .min(1)
  .max(100)
  .refine((jobs) => new Set(jobs.map((job) => job.id)).size === jobs.length);
const writeSchema = z
  .array(z.object({ recorded: z.number().int().min(0).max(1) }))
  .length(1);
const observationSchema = z.strictObject({
  queue: queueSchema,
  worker: workerSchema,
  recordedAt: z.date(),
  handlerReturnedAt: z.date(),
  release: z.string(),
  sourceSha: z.string(),
});
const WORK_RESULT_FRESH_SECONDS = 300;
const OBSERVATION_STATEMENT_TIMEOUT_MILLISECONDS = 1_000;
const OBSERVATION_LOCK_TIMEOUT_MILLISECONDS = 250;
const observationTransaction = {
  maxWait: 1_000,
  timeout: 2_000,
  isolationLevel: "ReadCommitted",
} as const;

type WorkPrisma = TransactionClient<Pick<PlatformPrisma, "$queryRaw">>;
export interface PgBossWorkObserver {
  completed(queue: string, jobs: readonly unknown[]): undefined;
}

/** One latest handler-result observation per fixed queue, independent of job-history deletion.
 * This is not a pg-boss ACK or an assertion about an external payment/delivery outcome.
 */
export class PgBossWorkObservation implements PgBossWorkObserver {
  private readonly identity: RuntimeIdentity;
  private readonly pending = new Map<
    z.infer<typeof queueSchema>,
    () => Promise<void>
  >();
  private running: Promise<void> | undefined;
  private closed = false;
  constructor(
    private readonly prisma: WorkPrisma,
    identity: RuntimeIdentity,
    private readonly worker: z.infer<typeof workerSchema>,
  ) {
    this.identity = runtimeIdentitySchema.parse(identity);
    workerSchema.parse(worker);
  }

  completed(queue: string, jobs: readonly unknown[]): undefined {
    const returnedAt = new Date();
    if (this.closed) throw new Error("queue_work_closed");
    const name = queueSchema.parse(queue);
    if (workers[name] !== this.worker) throw new Error("queue_work_owner");
    const attempts = attemptsSchema
      .parse(jobs)
      .sort((left, right) => left.id.localeCompare(right.id));
    const key = createHash("sha256")
      .update(JSON.stringify(attempts))
      .digest("hex");
    if (
      this.pending.has(name) ||
      this.pending.size >= Object.values(jobQueues).length
    )
      throw new Error("queue_work_buffer_full");
    const run = AsyncLocalStorage.snapshot();
    this.pending.set(name, () =>
      // Preserve the owned job log scope, but never make background SQL a child
      // of the business span which has already returned and may have ended.
      run(() =>
        context.with(ROOT_CONTEXT, async () => {
          try {
            await this.persist(name, attempts, key, returnedAt);
          } catch (error) {
            try {
              dependencyFailure(
                { module: "PgBossWorkObservation", operation: "completed" },
                error,
                undefined,
              );
            } catch {
              /* Diagnostic logging cannot reject the owned observation task. */
            }
          }
        }),
      ),
    );
    if (this.running === undefined) this.start();
    return undefined;
  }

  /** Tests and explicit callers can await all admitted facts without extending a native handler. */
  async flush(): Promise<void> {
    while (this.running !== undefined) await this.running;
  }

  /** Stop admission, discard unrecorded pending facts and settle only the bounded current write. */
  async close(): Promise<void> {
    this.closed = true;
    this.pending.clear();
    await this.running;
  }

  private start(): void {
    this.running = new Promise<void>((resolve) => setImmediate(resolve))
      .then(async () => {
        while (!this.closed) {
          const next = this.pending.entries().next().value;
          if (next === undefined) return;
          this.pending.delete(next[0]);
          await next[1]();
        }
      })
      .finally(() => {
        this.running = undefined;
        if (!this.closed && this.pending.size > 0) this.start();
      });
  }

  private async persist(
    name: z.infer<typeof queueSchema>,
    attempts: z.infer<typeof attemptsSchema>,
    key: string,
    returnedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`select
        set_config('statement_timeout', ${String(OBSERVATION_STATEMENT_TIMEOUT_MILLISECONDS)}, true),
        set_config('lock_timeout', ${String(OBSERVATION_LOCK_TIMEOUT_MILLISECONDS)}, true)`);
      const result: unknown = await transaction.$queryRaw(Prisma.sql`
        with admitted as materialized (
          select id from pgboss.job where name=${name} and state in ('active','completed')
            and (id,retry_count) in (${Prisma.join(attempts.map((job) => Prisma.sql`(${job.id}::uuid,${job.retryCount}::integer)`))})
          order by id
        ), instant as materialized (select clock_timestamp() as recorded_at), written as (
          insert into queue_observation.last_successful_handler as previous
            (queue_name,worker_name,handler_returned_at,recorded_at,release,source_sha,attempt_key)
          select ${name},${this.worker},${returnedAt},instant.recorded_at,${this.identity.release},${this.identity.sourceSha},${key}
          from instant where (select count(*) from admitted)=${attempts.length} and ${returnedAt}<=instant.recorded_at
          on conflict (queue_name) do update set
            worker_name=excluded.worker_name,handler_returned_at=excluded.handler_returned_at,recorded_at=excluded.recorded_at,
            release=excluded.release,source_sha=excluded.source_sha,attempt_key=excluded.attempt_key
          where previous.attempt_key<>excluded.attempt_key and previous.handler_returned_at<excluded.handler_returned_at
          returning 1
        ) select count(*)::integer as recorded from written
      `);
      writeSchema.parse(result);
    }, observationTransaction);
  }
}

/** Only the existing diagnostic snapshot transaction may read these fixed payload-free facts. */
export async function readPgBossWorkObservations(
  transaction: Pick<PlatformPrisma, "queueWorkObservation">,
  asOf: Date,
) {
  const value: unknown = await transaction.queueWorkObservation.findMany({
    orderBy: { queue: "asc" },
    take: 11,
    select: {
      queue: true,
      worker: true,
      recordedAt: true,
      handlerReturnedAt: true,
      release: true,
      sourceSha: true,
    },
  });
  return decodePgBossWorkObservations(value, asOf);
}

/** Validate the complete bounded source before exposing any per-queue observation. */
export function decodePgBossWorkObservations(value: unknown, asOf: Date) {
  const rows = z
    .array(observationSchema)
    .max(Object.values(jobQueues).length)
    .parse(value);
  if (new Set(rows.map((row) => row.queue)).size !== rows.length)
    throw new Error("queue_work_source");
  z.date()
    .refine((value) => value.getTime() > 0)
    .parse(asOf);
  return new Map(
    rows.map((row) => {
      const identity = runtimeIdentitySchema.parse({
        release: row.release,
        sourceSha: row.sourceSha,
      });
      if (
        workers[row.queue] !== row.worker ||
        row.handlerReturnedAt.getTime() <= 0 ||
        row.handlerReturnedAt > row.recordedAt ||
        row.recordedAt > asOf
      )
        throw new Error("queue_work_source");
      const ageSeconds =
        (asOf.getTime() - row.handlerReturnedAt.getTime()) / 1_000;
      return [
        row.queue,
        {
          status: "known" as const,
          meaning: "handler_result_committed" as const,
          worker: row.worker,
          at: row.handlerReturnedAt.toISOString(),
          observedAt: row.recordedAt.toISOString(),
          clock: "process_wall_clock" as const,
          ageSeconds,
          freshness:
            ageSeconds <= WORK_RESULT_FRESH_SECONDS
              ? ("recent" as const)
              : ("stale" as const),
          release: identity,
          nativeAck: "not_proven" as const,
          externalEffect: "not_proven" as const,
        },
      ] as const;
    }),
  );
}

export const unknownPgBossWork = {
  status: "unknown",
  reason: "no_history",
  at: null,
  ageSeconds: null,
  release: null,
} as const;
