import { ReadingActivityRetention } from "../modules/reading-activity/index.js";
import { BookmarkActivityRetention } from "../modules/bookmarks/index.js";
import { jobQueues } from "../infrastructure/job-queues.js";
import { WebTelemetry } from "../modules/web-telemetry/index.js";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
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
import { technicalTelemetryFromEnvironment } from "../infrastructure/observability/technical-telemetry-runtime.js";
import {
  RUNTIME_IDENTITY,
  type RuntimeIdentity,
} from "../infrastructure/runtime-identity.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { runWorker } from "../infrastructure/worker-runtime.js";
import {
  TributeConvergence,
  BillingNotices,
  BillingOperations,
  BillingPayments,
  BillingPricing,
  BillingSubscriptions,
} from "../modules/billing/index.js";
import {
  COMMUNITY_RECONCILIATION_INTERVAL_MS,
  CommunityEntitlements,
} from "../modules/telegram-membership/index.js";
import { BillingWorkerModule } from "./billing-worker/billing-worker.module.js";

import {
  runActivityRetentionJob,
  runRenewalJob,
  runRecoveryJob,
  runNoticeJob,
} from "./billing-worker/jobs.js";

const activityRetentionQueue = jobQueues.activityRetention;
const telemetryCleanupQueue = jobQueues.telemetryRetention;
// The watchdog reads completion over 26 hours; keep receipts across two daily runs.
const telemetryReceiptRetentionSeconds = 172_800;
const recoveryQueue = jobQueues.paymentRecovery;
const renewalQueue = jobQueues.subscriptionRenewal;
const noticeQueue = jobQueues.subscriptionNotices;
const tributeQueue = jobQueues.tributeReconciliation;
const communityQueue = jobQueues.communityDelivery;
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
  const tribute = application.get(TributeConvergence);
  const payments = application.get(BillingPayments);
  const subscriptions = application.get(BillingSubscriptions);
  const notices = application.get(BillingNotices);
  const operations = application.get(BillingOperations);
  const community = application.get(CommunityEntitlements);
  const technicalTelemetry = technicalTelemetryFromEnvironment({
    environment: process.env,
    service: "platform-billing-worker",
    mode: config.mode,
    identity: application.get<RuntimeIdentity>(RUNTIME_IDENTITY),
  });
  try {
    const jobs = new PgBoss({
      openTelemetry: technicalTelemetry.pgBoss([
        activityRetentionQueue,
        telemetryCleanupQueue,
        recoveryQueue,
        renewalQueue,
        noticeQueue,
        tributeQueue,
        communityQueue,
      ]),
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
        await jobs.createQueue(activityRetentionQueue, {
          deleteAfterSeconds: jobRetentionSeconds,
          expireInSeconds: jobTimeoutSeconds,
          retryLimit: 0,
        });
        await jobs.schedule(
          activityRetentionQueue,
          "* * * * *",
          {},
          { tz: "Etc/UTC" },
        );
        await jobs.send(
          activityRetentionQueue,
          {},
          { singletonSeconds: jobIntervalSeconds },
        );
        await jobs.work(
          activityRetentionQueue,
          observeJob(
            "billing-worker",
            activityRetentionQueue,
            async () => {
              const result = await runActivityRetentionJob(
                application.get(ReadingActivityRetention),
                application.get(BookmarkActivityRetention),
              );
              writeLog("info", "activity_retention_completed", result);
              return result;
            },
            technicalTelemetry,
          ),
        );
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
          observeJob(
            "billing-worker",
            telemetryCleanupQueue,
            async () => {
              const result = await telemetry.clean();
              if (!result.ok) throw new Error(result.error.code);
              return result;
            },
            technicalTelemetry,
          ),
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
          observeJob(
            "billing-worker",
            recoveryQueue,
            async () => {
              return runRecoveryJob(payments, operations);
            },
            technicalTelemetry,
          ),
        );
        await jobs.createQueue(renewalQueue, {
          deleteAfterSeconds: jobRetentionSeconds,
          expireInSeconds: jobTimeoutSeconds,
          retryLimit: 0,
        });
        await jobs.schedule(renewalQueue, "* * * * *", {});
        await jobs.send(
          renewalQueue,
          {},
          { singletonSeconds: jobIntervalSeconds },
        );
        await jobs.work(
          renewalQueue,
          observeJob(
            "billing-worker",
            renewalQueue,
            async () => {
              return runRenewalJob(payments, subscriptions);
            },
            technicalTelemetry,
          ),
        );
        await jobs.createQueue(noticeQueue, {
          deleteAfterSeconds: jobRetentionSeconds,
          expireInSeconds: jobTimeoutSeconds,
          retryLimit: 0,
        });
        await jobs.schedule(noticeQueue, "* * * * *", {});
        await jobs.send(
          noticeQueue,
          {},
          { singletonSeconds: jobIntervalSeconds },
        );
        await jobs.work(
          noticeQueue,
          observeJob(
            "billing-worker",
            noticeQueue,
            async () => {
              // Календарь напоминаний живёт отдельно от списаний: сбой одного не останавливает другое.
              return runNoticeJob(notices);
            },
            technicalTelemetry,
          ),
        );
        // Community delivery only runs where the provider direction is actually configured.
        await jobs.createQueue(tributeQueue, {
          deleteAfterSeconds: jobRetentionSeconds,
          expireInSeconds: jobTimeoutSeconds,
          retryLimit: 0,
        });
        await jobs.schedule(tributeQueue, "* * * * *", {});
        await jobs.send(
          tributeQueue,
          {},
          { singletonSeconds: jobIntervalSeconds },
        );
        await jobs.work(
          tributeQueue,
          observeJob(
            "billing-worker",
            tributeQueue,
            async () => {
              const report = await tribute.sweep(50);
              if (report.pending > 0)
                writeLog("warn", "queue_attention", {
                  status: "operator_attention",
                  pending: report.pending,
                });
            },
            technicalTelemetry,
          ),
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
          observeJob(
            "billing-worker",
            communityQueue,
            async () => {
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
            },
            technicalTelemetry,
          ),
        );
      },
    });
  } finally {
    await technicalTelemetry.shutdown();
  }
}
