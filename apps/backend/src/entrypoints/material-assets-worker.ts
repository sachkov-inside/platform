import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { runWorker } from "../infrastructure/worker-runtime.js";
import {
  MATERIAL_ASSET_MAINTENANCE,
  type MaterialAssetMaintenance,
} from "../modules/materials/index.js";
import { MaterialAssetsWorkerModule } from "./material-assets-worker/material-assets-worker.module.js";

const CLEANUP_QUEUE = "material-assets.cleanup";
const CLEANUP_JOB_RETENTION_SECONDS = 86_400;
const CLEANUP_JOB_TIMEOUT_SECONDS = 300;
const CLEANUP_RETRY_INITIAL_DELAY_SECONDS = 30;
const CLEANUP_RETRY_MAX_DELAY_SECONDS = 300;
const CLEANUP_RETRY_LIMIT = 5;
const CLEANUP_SINGLETON_SECONDS = 3_600;

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(
    MaterialAssetsWorkerModule.forRoot(),
  );
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  const maintenance = application.get<MaterialAssetMaintenance>(
    MATERIAL_ASSET_MAINTENANCE,
  );
  const readiness = application.get(OperationalReadiness);
  const jobs = new PgBoss({
    connectionString: config.database.url,
    createSchema: false,
    migrate: false,
    schema: "pgboss",
  });
  jobs.on("error", (error) => console.error(error));
  await runWorker({
    application,
    databaseUrl: config.database.url,
    jobs,
    process: "material-assets-worker",
    readiness,
    async registerJobs() {
      await jobs.createQueue(CLEANUP_QUEUE, {
        deleteAfterSeconds: CLEANUP_JOB_RETENTION_SECONDS,
        expireInSeconds: CLEANUP_JOB_TIMEOUT_SECONDS,
        retryBackoff: true,
        retryDelay: CLEANUP_RETRY_INITIAL_DELAY_SECONDS,
        retryDelayMax: CLEANUP_RETRY_MAX_DELAY_SECONDS,
        retryLimit: CLEANUP_RETRY_LIMIT,
      });
      await jobs.schedule(CLEANUP_QUEUE, "17 * * * *", {});
      await jobs.send(CLEANUP_QUEUE, {}, {
        singletonSeconds: CLEANUP_SINGLETON_SECONDS,
      });
      await jobs.work(CLEANUP_QUEUE, async () => {
        const result = await maintenance.cleanup();
        if (!result.ok) throw new Error(result.error.code);
        return result;
      });
    },
  });
}
