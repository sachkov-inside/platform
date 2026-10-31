import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
import "reflect-metadata";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import {
  StructuredNestLogger,
  observeJob,
  reportProcessFailure,
  reportQueueFailure,
  writeLog,
} from "../infrastructure/observability/index.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { runWorker } from "../infrastructure/worker-runtime.js";
import {
  BillingOperations,
  BillingPayments,
  BillingPricing,
} from "../modules/billing/index.js";
import {
  COMMUNITY_RECONCILIATION_INTERVAL_MS,
  CommunityEntitlements,
} from "../modules/telegram-membership/index.js";
import { WebTelemetry } from "../modules/web-telemetry/index.js";
import { BillingWorkerModule } from "./billing-worker/billing-worker.module.js";

import {
  recoveryBudgetMilliseconds,
  runRecoveryJob,
} from "./billing-worker/jobs.js";

const telemetryCleanupQueue = "web-telemetry.retention";
// The watchdog reads completion over 26 hours; keep receipts across two daily runs.
const telemetryReceiptRetentionSeconds = 172_800;
const recoveryQueue = "billing.payment-recovery";
const communityQueue = "community.entitlement-delivery";
const communityBatchSize = 50;
const communityIntervalSeconds = COMMUNITY_RECONCILIATION_INTERVAL_MS / 1_000;
const jobTimeoutSeconds = 300;
const jobRetentionSeconds = 86_400;
const jobIntervalSeconds = 60;
void bootstrap().catch((error: unknown) =>
  reportProcessFailure("billing-worker", error),
);
async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(
    BillingWorkerModule.forRoot(),
    { logger: new StructuredNestLogger() },
  );
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  try {
    // Включённая продажа требует настроек; фоновые пробеги отдельно сообщают простой.
    await application.get(BillingPricing).assertSaleConfigured(config);
  } catch (error) {
    await application.close();
    throw error;
  }
  const telemetry = application.get(WebTelemetry);
  const payments = application.get(BillingPayments);
  const operations = application.get(BillingOperations);
  const community = application.get(CommunityEntitlements);
  const jobs = new PgBoss({
    connectionString: config.database.url,
    createSchema: false,
    migrate: false,
    schema: "pgboss",
  });
  jobs.on("error", (error: unknown) =>
    reportQueueFailure("billing-worker", error),
  );
  await runWorker({
    application,
    databaseUrl: config.database.url,
    jobs,
    process: "billing-worker",
    readiness: application.get(OperationalReadiness),
    async registerJobs() {
      await jobs.createQueue(telemetryCleanupQueue, {
        deleteAfterSeconds: telemetryReceiptRetentionSeconds,
        expireInSeconds: jobTimeoutSeconds,
        retryLimit: 0,
      });
      await jobs.schedule(
        telemetryCleanupQueue,
        "0 3 * * *",
        {},
        { tz: "Etc/UTC" },
      );
      await jobs.send(
        telemetryCleanupQueue,
        {},
        { singletonSeconds: jobRetentionSeconds },
      );
      await jobs.work(
        telemetryCleanupQueue,
        observeJob("billing-worker", telemetryCleanupQueue, async () => {
          const result = await telemetry.clean();
          if (!result.ok) throw new Error(result.error.code);
          return result;
        }),
      );
      await jobs.createQueue(recoveryQueue, {
        deleteAfterSeconds: jobRetentionSeconds,
        expireInSeconds: jobTimeoutSeconds,
        retryLimit: 0,
      });
      await jobs.schedule(recoveryQueue, "* * * * *", {});
      await jobs.send(
        recoveryQueue,
        {},
        { singletonSeconds: jobIntervalSeconds },
      );
      await jobs.work(
        recoveryQueue,
        observeJob("billing-worker", recoveryQueue, async () => {
          return runRecoveryJob(
            payments,
            operations,
            AbortSignal.timeout(
              recoveryBudgetMilliseconds(jobTimeoutSeconds * 1_000),
            ),
          );
        }),
      );
      if (!config.communityEntitlements) return;
      await jobs.createQueue(communityQueue, {
        deleteAfterSeconds: jobRetentionSeconds,
        expireInSeconds: jobTimeoutSeconds,
        retryLimit: 0,
      });
      await jobs.schedule(communityQueue, "* * * * *", {});
      await jobs.send(
        communityQueue,
        {},
        { singletonSeconds: communityIntervalSeconds },
      );
      await jobs.work(
        communityQueue,
        observeJob("billing-worker", communityQueue, async () => {
          const report = await community.sweep(communityBatchSize);
          if (
            report.backlog.overdue > 0 ||
            report.backlog.rejected > 0 ||
            report.failed > 0
          ) {
            // Overdue or refused community work is operator attention, not a silent retry.
            writeLog("warn", "queue_attention", {
              status: "operator_attention",
              ...report,
            });
          }
          return report;
        }),
      );
    },
  });
}
