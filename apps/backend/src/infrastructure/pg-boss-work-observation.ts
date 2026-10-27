import { createHash } from "node:crypto";

import { runtimeIdentitySchema } from "@inside/runtime-identity";
import { z } from "zod";

import { jobQueues } from "./job-queues.js";
import {
  Prisma,
  type PlatformPrisma,
  type TransactionClient,
} from "./prisma/index.js";
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
  completed(queue: string, jobs: readonly unknown[]): Promise<void>;
}

/** One latest handler-result observation per fixed queue, independent of job-history deletion.
 * This is not a pg-boss ACK or an assertion about an external payment/delivery outcome.
 */
export class PgBossWorkObservation implements PgBossWorkObserver {
  private readonly identity: RuntimeIdentity;
  constructor(
    private readonly prisma: WorkPrisma,
    identity: RuntimeIdentity,
    private readonly worker: z.infer<typeof workerSchema>,
  ) {
    this.identity = runtimeIdentitySchema.parse(identity);
    workerSchema.parse(worker);
  }

  async completed(queue: string, jobs: readonly unknown[]): Promise<void> {
    const name = queueSchema.parse(queue);
    if (workers[name] !== this.worker) throw new Error("queue_work_owner");
    const attempts = attemptsSchema
      .parse(jobs)
      .sort((left, right) => left.id.localeCompare(right.id));
    const key = createHash("sha256")
      .update(JSON.stringify(attempts))
      .digest("hex");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`select
        set_config('statement_timeout', ${String(OBSERVATION_STATEMENT_TIMEOUT_MILLISECONDS)}, true),
        set_config('lock_timeout', ${String(OBSERVATION_LOCK_TIMEOUT_MILLISECONDS)}, true)`);
      const result: unknown = await transaction.$queryRaw(Prisma.sql`
        with admitted as materialized (
          select id from pgboss.job where name=${name} and state='active'
            and (id,retry_count) in (${Prisma.join(attempts.map((job) => Prisma.sql`(${job.id}::uuid,${job.retryCount}::integer)`))})
          order by id for update
        ), instant as materialized (select clock_timestamp() as recorded_at), written as (
          insert into queue_observation.last_successful_handler as previous
            (queue_name,worker_name,recorded_at,release,source_sha,attempt_key)
          select ${name},${this.worker},instant.recorded_at,${this.identity.release},${this.identity.sourceSha},${key}
          from instant where (select count(*) from admitted)=${attempts.length}
          on conflict (queue_name) do update set
            worker_name=excluded.worker_name,recorded_at=excluded.recorded_at,
            release=excluded.release,source_sha=excluded.source_sha,attempt_key=excluded.attempt_key
          where previous.attempt_key<>excluded.attempt_key and previous.recorded_at<excluded.recorded_at
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
        row.recordedAt.getTime() <= 0 ||
        row.recordedAt > asOf
      )
        throw new Error("queue_work_source");
      const ageSeconds = (asOf.getTime() - row.recordedAt.getTime()) / 1_000;
      return [
        row.queue,
        {
          status: "known" as const,
          meaning: "handler_result_committed" as const,
          worker: row.worker,
          at: row.recordedAt.toISOString(),
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
