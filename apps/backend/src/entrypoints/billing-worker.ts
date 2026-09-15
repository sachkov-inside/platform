import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
import { PLATFORM_CONFIG, type PlatformConfig } from "../config/platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { runWorker } from "../infrastructure/worker-runtime.js";
import { TributeConvergence, BillingNotices, BillingOperations, BillingPayments, BillingPricing, BillingSubscriptions, SaleConfigurationError } from "../modules/billing/index.js";
import { COMMUNITY_RECONCILIATION_INTERVAL_MS, CommunityEntitlements } from "../modules/telegram-membership/index.js";
import { BillingWorkerModule } from "./billing-worker/billing-worker.module.js";

const recoveryQueue = "billing.payment-recovery";
const renewalQueue = "billing.subscription-renewal";
const noticeQueue = "billing.subscription-notices";
const tributeQueue = "tribute.source-reconciliation";
const communityQueue = "community.entitlement-delivery";
const communityBatchSize = 50;
const communityIntervalSeconds = COMMUNITY_RECONCILIATION_INTERVAL_MS / 1_000;
const jobTimeoutSeconds = 300;
const jobRetentionSeconds = 86_400;
const jobIntervalSeconds = 60;
void bootstrap().catch(() => { console.error("Billing worker failed"); process.exitCode = 1; });
async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(BillingWorkerModule.forRoot());
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  try {
    // Сверка и возвраты без терминала молча ничего не делают: включённая продажа требует настроек.
    await application.get(BillingPricing).assertSaleConfigured(config);
  } catch (error) {
    await application.close();
    if (error instanceof SaleConfigurationError) {
      console.error(JSON.stringify({ process: "billing-worker", status: "operator_attention", reason: error.message }));
    }
    throw error;
  }
  const tribute = application.get(TributeConvergence);
  const payments = application.get(BillingPayments);
  const subscriptions = application.get(BillingSubscriptions);
  const notices = application.get(BillingNotices);
  const operations = application.get(BillingOperations);
  const community = application.get(CommunityEntitlements);
  const jobs = new PgBoss({ connectionString: config.database.url, createSchema: false, migrate: false, schema: "pgboss" });
  jobs.on("error", () => console.error("Billing recovery queue unavailable"));
  await runWorker({ application, databaseUrl: config.database.url, jobs, process: "billing-worker", readiness: application.get(OperationalReadiness),
    async registerJobs() {
      await jobs.createQueue(recoveryQueue, { deleteAfterSeconds: jobRetentionSeconds, expireInSeconds: jobTimeoutSeconds, retryLimit: 0 });
      await jobs.schedule(recoveryQueue, "* * * * *", {});
      await jobs.send(recoveryQueue, {}, { singletonSeconds: jobIntervalSeconds });
      await jobs.work(recoveryQueue, async () => {
        const result = await payments.recover(20);
        if (!result.ok) throw new Error(result.error.code);
        // Незавершённый возврат сверяется тем же ExternalRequestId и не отправляется заново.
        const refunds = await operations.reconcileRefunds(20);
        return { ...result.value, refunds };
      });
      await jobs.createQueue(renewalQueue, { deleteAfterSeconds: jobRetentionSeconds, expireInSeconds: jobTimeoutSeconds, retryLimit: 0 });
      await jobs.schedule(renewalQueue, "* * * * *", {});
      await jobs.send(renewalQueue, {}, { singletonSeconds: jobIntervalSeconds });
      await jobs.work(renewalQueue, async () => {
        const renewed = await payments.renew(20);
        if (!renewed.ok) throw new Error(renewed.error.code);
        const bindings = await subscriptions.reconcileMethodFlows(20);
        // Смена карты не настроена терминалом: продление остаётся рабочим результатом задания.
        return { ...renewed.value, bindings: bindings.ok ? bindings.value : bindings.error.code };
      });
      await jobs.createQueue(noticeQueue, { deleteAfterSeconds: jobRetentionSeconds, expireInSeconds: jobTimeoutSeconds, retryLimit: 0 });
      await jobs.schedule(noticeQueue, "* * * * *", {});
      await jobs.send(noticeQueue, {}, { singletonSeconds: jobIntervalSeconds });
      await jobs.work(noticeQueue, async () => {
        // Календарь напоминаний живёт отдельно от списаний: сбой одного не останавливает другое.
        const result = await notices.scheduleReminders(20);
        if (!result.ok) throw new Error(result.error.code);
        return result.value;
      });
      // Community delivery only runs where the provider direction is actually configured.
      await jobs.createQueue(tributeQueue, { deleteAfterSeconds: jobRetentionSeconds, expireInSeconds: jobTimeoutSeconds, retryLimit: 0 });
      await jobs.schedule(tributeQueue, "* * * * *", {});
      await jobs.send(tributeQueue, {}, { singletonSeconds: jobIntervalSeconds });
      await jobs.work(tributeQueue, async () => {
        const report = await tribute.sweep(50);
        if (report.pending > 0) console.warn(JSON.stringify({ process: "billing-worker", queue: tributeQueue, status: "operator_attention", pending: report.pending }));
      });
      if (!config.communityEntitlements) return;
      await jobs.createQueue(communityQueue, { deleteAfterSeconds: jobRetentionSeconds, expireInSeconds: jobTimeoutSeconds, retryLimit: 0 });
      await jobs.schedule(communityQueue, "* * * * *", {});
      await jobs.send(communityQueue, {}, { singletonSeconds: communityIntervalSeconds });
      await jobs.work(communityQueue, async () => {
        const report = await community.sweep(communityBatchSize);
        if (report.backlog.overdue > 0 || report.backlog.rejected > 0 || report.failed > 0) {
          // Overdue or refused community work is operator attention, not a silent retry.
          console.warn(JSON.stringify({ process: "billing-worker", queue: communityQueue, status: "operator_attention", ...report }));
        }
        return report;
      });
    },
  });
}
