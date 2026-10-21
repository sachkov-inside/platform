import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { PgBossQueueDiagnostics } from "../../src/infrastructure/pg-boss-queue-diagnostics.js";
import { startNotificationBroker } from "./setup/broker.js";
import { localNotificationTopology } from "../../src/infrastructure/notification-transport/topology.js";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { PgBoss } from "pg-boss";
import { expect, test } from "vitest";
import { z } from "zod";
import { WORKER_READINESS_PATH } from "../../src/infrastructure/worker-runtime.js";
import { migrateRuntimeDatabase } from "../../src/migrations/migrate.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";
import { eventually } from "./setup/eventually.js";
import {
  boundedProcessFact,
  finishFixtureCleanup,
  launchQueueTelemetryProcess,
  type QueueTelemetryProcess,
} from "./setup/queue-telemetry-process.js";

const WORKER_FACT_BUDGET_MS = 20_000;
const cases = [
  { worker: "notifications-worker", queues: [], retentionFailure: "none" },
  {
    worker: "profile-avatars-worker",
    queues: ["profile-avatars.cleanup"],
    retentionFailure: "none",
  },
  {
    worker: "video-deletions-worker",
    queues: ["videos.deletions"],
    retentionFailure: "none",
  },
  {
    worker: "billing-worker",
    retentionFailure: "none",
    queues: [
      "web-telemetry.retention",
      "membership-activity.retention",
      "billing.payment-recovery",
      "billing.subscription-renewal",
      "billing.subscription-notices",
      "tribute.source-reconciliation",
    ],
  },
  {
    worker: "billing-worker",
    retentionFailure: "registration_refusal",
    queues: [
      "web-telemetry.retention",
      "billing.payment-recovery",
      "billing.subscription-renewal",
      "billing.subscription-notices",
      "tribute.source-reconciliation",
    ],
  },
  {
    worker: "billing-worker",
    retentionFailure: "partial",
    queues: [
      "web-telemetry.retention",
      "billing.payment-recovery",
      "billing.subscription-renewal",
      "billing.subscription-notices",
      "tribute.source-reconciliation",
    ],
  },
] as const;
const workerMessage = z.object({
  kind: z.literal("worker"),
  pid: z.number().int().positive(),
});
const log = z
  .object({
    event: z.string(),
    release: z
      .union([z.string(), z.object({ release: z.string() }).loose()])
      .optional(),
  })
  .loose();

for (const { worker, queues, retentionFailure } of cases) {
  for (const mode of retentionFailure === "none"
    ? (["enabled", "off", "export-failure"] as const)
    : (["off"] as const)) {
    test(`${worker} preserves completed jobs and drain with technical telemetry ${mode}${retentionFailure === "none" ? "" : ` (${retentionFailure})`}`, async () => {
      await expect(access(WORKER_READINESS_PATH)).rejects.toThrow();
      const database = await createMigratedTestDatabase();
      const captured: string[] = [];
      const receiver = createServer((request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk: string) => {
          body += chunk;
        });
        request.on("end", () => {
          captured.push(body);
          response.writeHead(mode === "export-failure" ? 503 : 200, {
            "content-type": "application/json",
          });
          response.end(
            mode === "export-failure" ? "private-export-error-sentinel" : "{}",
          );
        });
      });
      const inspector = new PgBoss({
        connectionString: database.url,
        openTelemetry: { enabled: false },
        createSchema: false,
        migrate: false,
      });
      let child: QueueTelemetryProcess | undefined;
      let broker:
        Awaited<ReturnType<typeof startNotificationBroker>> | undefined;
      let workerPid: number | undefined;
      let signalled = false;
      let renamedActivity = false;
      const stopWorker = async () => {
        if (child === undefined) return;
        if (
          workerPid !== undefined &&
          !signalled &&
          child.child.exitCode === null
        ) {
          signalled = true;
          try {
            process.kill(workerPid, "SIGTERM");
          } catch (error) {
            if (!(
              error instanceof Error &&
              "code" in error &&
              error.code === "ESRCH"
            ))
              throw error;
          }
        }
        try {
          await boundedProcessFact(child.exited);
        } finally {
          await child.stop();
        }
      };
      try {
        await migrateRuntimeDatabase(database.url);
        if (worker === "notifications-worker")
          broker = await startNotificationBroker({
            topology: localNotificationTopology("inside-test", 100),
          });
        if (retentionFailure === "registration_refusal") {
          await database.prisma.$executeRaw(
            Prisma.sql`create function public.refuse_activity_retention() returns trigger language plpgsql as $$ begin if NEW.name='membership-activity.retention' then raise exception 'owned queue refusal'; end if; return NEW; end $$`,
          );
          await database.prisma.$executeRaw(
            Prisma.sql`create trigger refuse_activity_retention before insert on pgboss.queue for each row execute function public.refuse_activity_retention()`,
          );
        }
        if (retentionFailure === "partial") {
          await database.prisma.$executeRaw(
            Prisma.sql`insert into reading_activity.learning_started_events(event_id,account_id,product_id,command_id,occurred_at) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),transaction_timestamp()-interval '366 days')`,
          );
          await database.prisma.$executeRaw(
            Prisma.sql`insert into bookmarks.activity_events(event_id,account_id,material_id,event_type,occurred_at) values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'bookmark_added',transaction_timestamp()-interval '366 days')`,
          );
          await database.prisma.$executeRaw(
            Prisma.sql`alter table bookmarks.activity_events rename to unavailable_activity_events`,
          );
          renamedActivity = true;
        }
        receiver.listen(0, "127.0.0.1");
        await once(receiver, "listening");
        const address = receiver.address();
        if (address === null || typeof address === "string")
          throw new Error("receiver address unavailable");
        await inspector.start();
        child = launchQueueTelemetryProcess({
          databaseUrl: database.url,
          endpoint: `http://127.0.0.1:${address.port}`,
          mode: "worker",
          worker,
          enabled: mode !== "off",
          ...(broker === undefined ? {} : { brokerUrls: broker.urls }),
        });
        workerPid = workerMessage.parse(
          await boundedProcessFact(child.firstMessage),
        ).pid;
        const processOutput = child.output;
        await eventually(async () => {
          expect(
            processOutput.some(
              (line) => log.parse(JSON.parse(line)).event === "worker_ready",
            ),
          ).toBe(true);
          for (const queue of queues) {
            const jobs = (await inspector.findJobs(queue)).filter(
              (job) => job.state === "completed",
            );
            expect(jobs.length).toBeGreaterThan(0);
            expect(jobs.every((job) => JSON.stringify(job.data) === "{}")).toBe(
              true,
            );
          }
        }, WORKER_FACT_BUDGET_MS);
        if (retentionFailure === "registration_refusal") {
          expect(
            await inspector.getQueue("membership-activity.retention"),
          ).toBeNull();
          expect(
            await new PgBossQueueDiagnostics(
              database.prisma,
            ).readActivityRetentionLastPass(),
          ).toMatchObject({ ok: false, error: { code: "no_retained_pass" } });
        }
        if (retentionFailure === "partial") {
          const diagnostics = new PgBossQueueDiagnostics(database.prisma);
          await eventually(async () => {
            expect(
              await diagnostics.readActivityRetentionLastPass(),
            ).toMatchObject({
              ok: true,
              value: {
                state: "failed",
                report: {
                  sources: [
                    { result: { ok: true, value: { removed: 1 } } },
                    { result: { ok: false } },
                  ],
                },
              },
            });
          }, WORKER_FACT_BUDGET_MS);
          expect(
            await database.prisma.$queryRaw(
              Prisma.sql`select count(*)::int as remaining from reading_activity.learning_started_events`,
            ),
          ).toEqual([{ remaining: 0 }]);
          await database.prisma.$executeRaw(
            Prisma.sql`alter table bookmarks.unavailable_activity_events rename to activity_events`,
          );
          renamedActivity = false;
          await inspector.send("membership-activity.retention", {});
          await eventually(async () => {
            expect(
              await diagnostics.readActivityRetentionLastPass(),
            ).toMatchObject({
              ok: true,
              value: {
                state: "completed",
                report: {
                  sources: [
                    { result: { ok: true, value: { removed: 0 } } },
                    { result: { ok: true, value: { removed: 1 } } },
                  ],
                },
              },
            });
          }, WORKER_FACT_BUDGET_MS);
        }
        const completedIds: string[] = [];
        for (const queue of queues) {
          const policy = await inspector.getQueue(queue);
          expect(policy).toMatchObject({
            deleteAfterSeconds:
              queue === "web-telemetry.retention" ? 172_800 : 86_400,
            expireInSeconds: 300,
            retryLimit: worker === "billing-worker" ? 0 : 5,
            ...(worker === "billing-worker"
              ? {}
              : { retryBackoff: true, retryDelay: 30, retryDelayMax: 300 }),
          });
          const schedules = await inspector.getSchedules(queue);
          expect(schedules).toHaveLength(1);
          expect(schedules[0]).toMatchObject({
            cron:
              queue === "profile-avatars.cleanup"
                ? "23 * * * *"
                : queue === "web-telemetry.retention"
                  ? "0 3 * * *"
                  : "* * * * *",
            data: {},
          });
          if (
            queue === "web-telemetry.retention" ||
            queue === "membership-activity.retention"
          )
            expect(schedules[0]?.timezone).toBe("Etc/UTC");
          const jobs = await inspector.findJobs(queue);
          expect(
            jobs.every(
              (job) => job.state === "completed" && job.retryCount === 0,
            ),
          ).toBe(true);
          completedIds.push(...jobs.map((job) => job.id));
        }
        expect(
          await inspector.getQueue("community.entitlement-delivery"),
        ).toBeNull();
        await stopWorker();
        expect(await child.exited).toEqual([0, null]);
        const logs = processOutput.map((line) => log.parse(JSON.parse(line)));
        const lifecycle = logs.filter((record) =>
          ["worker_ready", "worker_draining", "worker_stopped"].includes(
            record.event,
          ),
        );
        expect(lifecycle.map((record) => record.event)).toEqual([
          "worker_ready",
          "worker_draining",
          "worker_stopped",
        ]);
        expect(
          lifecycle.every(
            (record) =>
              typeof record.release === "object" &&
              record.release.release === "test",
          ),
        ).toBe(true);
        await expect(access(WORKER_READINESS_PATH)).rejects.toThrow();
        if (mode === "off") expect(captured).toHaveLength(0);
        else {
          const wire = captured.join("\n");
          expect(wire).toContain(`platform-${worker}`);
          for (const queue of queues)
            expect(wire).toContain(`process ${queue}`);
          for (const id of completedIds) expect(wire).toContain(id);
          expect(wire).toContain("resourceMetrics");
          expect(wire).not.toContain("private-export-error-sentinel");
          if (mode === "export-failure") {
            expect(
              logs.some((record) => record.event === "telemetry_export_failed"),
            ).toBe(true);
            expect(processOutput.join("")).not.toContain(
              "private-export-error-sentinel",
            );
          }
        }
      } finally {
        await finishFixtureCleanup([
          stopWorker,
          async () => {
            if (renamedActivity) {
              await database.prisma.$executeRaw(
                Prisma.sql`alter table bookmarks.unavailable_activity_events rename to activity_events`,
              );
              renamedActivity = false;
            }
          },
          () => inspector.stop({ close: true, graceful: false }),
          () =>
            new Promise<void>((resolve, reject) =>
              receiver.close((error) => (error ? reject(error) : resolve())),
            ),
          () => broker?.stop(),
          () => database.dispose(),
        ]);
      }
    });
  }
}
