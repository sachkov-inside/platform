import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
import { PLATFORM_CONFIG, type PlatformConfig } from "../config/platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { runWorker } from "../infrastructure/worker-runtime.js";
import { BillingPayments, BillingSubscriptions } from "../modules/billing/index.js";
import { BillingWorkerModule } from "./billing-worker/billing-worker.module.js";

const recoveryQueue = "billing.payment-recovery";
const renewalQueue = "billing.subscription-renewal";
const jobTimeoutSeconds = 300;
const jobRetentionSeconds = 86_400;
const jobIntervalSeconds = 60;
void bootstrap().catch(() => { console.error("Billing worker failed"); process.exitCode = 1; });
async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(BillingWorkerModule.forRoot());
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  const payments = application.get(BillingPayments);
  const subscriptions = application.get(BillingSubscriptions);
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
        return result.value;
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
    },
  });
}
