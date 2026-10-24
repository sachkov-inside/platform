import {
  activityRetentionLastPass,
  activityRetentionReceiptUnknown,
  ACTIVITY_RETENTION_REPORT_BYTES,
} from "./activity-retention.js";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { expectedPgBossSchemaVersion } from "../migrations/runtime-schema.js";
import {
  diagnosticSnapshotOptions,
  setDiagnosticStatementBudget,
} from "./diagnostic-read-budget.js";
import { jobQueues } from "./job-queues.js";
import { dependencyFailure } from "./observability/index.js";
import {
  Prisma,
  PrismaClientProvider,
  type PlatformPrisma,
  type TransactionClient,
} from "./prisma/index.js";

type QueueDiagnosticPrisma = TransactionClient<
  Pick<PlatformPrisma, "$queryRaw" | "$executeRaw">
>;

const countSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rowSchema = z.object({
  name: z.enum(Object.values(jobQueues)),
  created: countSchema,
  retry: countSchema,
  active: countSchema,
  completed: countSchema,
  cancelled: countSchema,
  failed: countSchema,
  ready: countSchema,
  scheduled: countSchema,
  blocked: countSchema,
  retrying: countSchema,
  retryAttempts: countSchema,
  oldestAge: z.number().nonnegative().nullable(),
});
const snapshotSchema = z
  .array(z.object({ asOf: z.date(), version: z.number().int() }))
  .length(1);

/** Infrastructure owns pg-boss. read() remains payload-free; the separate fixed retention projection reads only its validated aggregate report. */
@Injectable()
export class PgBossQueueDiagnostics {
  constructor(
    @Inject(PrismaClientProvider)
    private readonly prisma: QueueDiagnosticPrisma,
  ) {}

  async read() {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(Prisma.sql`set transaction read only`);
        await setDiagnosticStatementBudget(transaction);
        const snapshot = snapshotSchema.parse(
          await transaction.$queryRaw(Prisma.sql`
          select transaction_timestamp() as "asOf", version from pgboss.version
        `),
        )[0];
        if (
          snapshot === undefined ||
          snapshot.version !== expectedPgBossSchemaVersion
        )
          return {
            ok: false as const,
            coverage: "unknown" as const,
            error: { code: "schema_mismatch" as const },
          };
        const names = Object.values(jobQueues);
        const rows = z
          .array(rowSchema)
          .max(names.length)
          .parse(
            await transaction.$queryRaw(Prisma.sql`
          select q.name,
            count(j.id) filter (where j.state = 'created')::double precision as created,
            count(j.id) filter (where j.state = 'retry')::double precision as retry,
            count(j.id) filter (where j.state = 'active')::double precision as active,
            count(j.id) filter (where j.state = 'completed')::double precision as completed,
            count(j.id) filter (where j.state = 'cancelled')::double precision as cancelled,
            count(j.id) filter (where j.state = 'failed')::double precision as failed,
            count(j.id) filter (where j.state in ('created','retry') and not j.blocked and j.start_after <= transaction_timestamp())::double precision as ready,
            count(j.id) filter (where j.state in ('created','retry') and not j.blocked and j.start_after > transaction_timestamp())::double precision as scheduled,
            count(j.id) filter (where j.state in ('created','retry') and j.blocked)::double precision as blocked,
            count(j.id) filter (where j.state in ('created','retry','active') and j.retry_count > 0)::double precision as retrying,
            coalesce(sum(j.retry_count),0)::double precision as "retryAttempts",
            case when count(j.id) filter (where j.state in ('created','retry')) = 0 then null else greatest(0, date_part('epoch', transaction_timestamp() - min(j.created_on) filter (where j.state in ('created','retry')))) end::double precision as "oldestAge"
          from pgboss.queue q left join pgboss.job j on j.name = q.name
          where q.name in (${Prisma.join(names)}) group by q.name order by q.name
        `),
          );
        return {
          ok: true as const,
          value: {
            schemaVersion: snapshot.version,
            asOf: snapshot.asOf.toISOString(),
            workerFreshness: "not_proven" as const,
            lastSuccessfulWorkAt: null,
            queues: names.map((name) => {
              const row = rows.find((candidate) => candidate.name === name);
              if (row === undefined)
                return {
                  name,
                  status: "unknown" as const,
                  reason: "queue_not_registered" as const,
                };
              return {
                name,
                status: "known" as const,
                states: {
                  created: row.created,
                  retry: row.retry,
                  active: row.active,
                  completed: row.completed,
                  cancelled: row.cancelled,
                  failed: row.failed,
                },
                backlog: row.created + row.retry,
                ready: row.ready,
                scheduled: row.scheduled,
                blocked: row.blocked,
                retrying: row.retrying,
                retainedRetryAttempts: row.retryAttempts,
                oldestBacklogAgeSeconds: row.oldestAge,
              };
            }),
          },
        };
      }, diagnosticSnapshotOptions);
    } catch (error) {
      return dependencyFailure(
        { module: "PgBossQueueDiagnostics", operation: "read" },
        error,
        {
          ok: false as const,
          coverage: "unknown" as const,
          error: { code: "source_unavailable" as const },
        },
      );
    }
  }
  async readActivityRetentionLastPass() {
    try {
      return await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw(Prisma.sql`set transaction read only`);
        await setDiagnosticStatementBudget(transaction);
        const snapshot = snapshotSchema.parse(
          await transaction.$queryRaw(
            Prisma.sql`select transaction_timestamp() as "asOf",version from pgboss.version`,
          ),
        )[0];
        if (
          snapshot === undefined ||
          snapshot.version !== expectedPgBossSchemaVersion
        )
          return activityRetentionReceiptUnknown("schema_mismatch");
        const raw: unknown = await transaction.$queryRaw(Prisma.sql`
        with candidates as materialized (
          select id,state,completed_on from pgboss.job where name=${jobQueues.activityRetention} order by id limit 2001
        ), budget as (select count(*)::integer as n,coalesce(bool_or(state in ('completed','failed') and completed_on is null),false) as invalid from candidates),
        latest as (
          select id,state,completed_on from candidates cross join budget where budget.n<=2000 and not budget.invalid and state in ('completed','failed')
          order by completed_on desc nulls last,id desc limit 1
        )
        select to_char(transaction_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "asOf",budget.n as "candidateCount",budget.invalid as "headerInvalid",latest.state::text as state,
          to_char(latest.completed_on at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "completedAt",
          date_part('epoch',transaction_timestamp()-latest.completed_on)::double precision as "ageSeconds",
          case when latest.id is null or budget.n>2000 then null
            when job.output->'activityRetention' is null then 'missing_report'
            when octet_length((job.output->'activityRetention')::text)>${ACTIVITY_RETENTION_REPORT_BYTES} then 'oversized_report' else null end as "reportReason",
          case when budget.n<=2000 and octet_length((job.output->'activityRetention')::text)<=${ACTIVITY_RETENTION_REPORT_BYTES}
            then job.output->'activityRetention' else null end as report
        from budget left join latest on true
        left join pgboss.job job on job.name=${jobQueues.activityRetention} and job.id=latest.id
      `);
        return activityRetentionLastPass(raw);
      }, diagnosticSnapshotOptions);
    } catch (error) {
      return dependencyFailure(
        {
          module: "PgBossQueueDiagnostics",
          operation: "readActivityRetentionLastPass",
        },
        error,
        activityRetentionReceiptUnknown("source_unavailable"),
      );
    }
  }
}
