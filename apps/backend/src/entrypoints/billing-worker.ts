import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";
import { PLATFORM_CONFIG, type PlatformConfig } from "../config/platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { runWorker } from "../infrastructure/worker-runtime.js";
import { BillingPayments } from "../modules/billing/index.js";
import { BillingWorkerModule } from "./billing-worker/billing-worker.module.js";

const recoveryQueue = "billing.payment-recovery";
const recoveryTimeoutSeconds = 300;
const recoveryRetentionSeconds = 86_400;
const recoveryIntervalSeconds = 60;
void bootstrap().catch(() => { console.error("Billing worker failed"); process.exitCode = 1; });
async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(BillingWorkerModule.forRoot());
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  const payments = application.get(BillingPayments);
  const jobs = new PgBoss({ connectionString: config.database.url, createSchema: false, migrate: false, schema: "pgboss" });
  jobs.on("error", () => console.error("Billing recovery queue unavailable"));
  await runWorker({ application, databaseUrl: config.database.url, jobs, process: "billing-worker", readiness: application.get(OperationalReadiness),
    async registerJobs() {
      await jobs.createQueue(recoveryQueue, { deleteAfterSeconds: recoveryRetentionSeconds, expireInSeconds: recoveryTimeoutSeconds, retryLimit: 0 });
      await jobs.schedule(recoveryQueue, "* * * * *", {});
      await jobs.send(recoveryQueue, {}, { singletonSeconds: recoveryIntervalSeconds });
      await jobs.work(recoveryQueue, async () => {
        const result = await payments.recover(20);
        if (!result.ok) throw new Error(result.error.code);
        return result.value;
      });
    },
  });
}
