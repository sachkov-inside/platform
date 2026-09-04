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
  MATERIAL_CONTENT,
  type MaterialContent,
} from "../modules/materials/index.js";
import {
  VIDEO_DELETION_MAINTENANCE,
  type VideoDeletionMaintenance,
} from "../modules/videos/index.js";
import { VideoDeletionsWorkerModule } from "./video-deletions-worker/video-deletions-worker.module.js";

const DELETION_QUEUE = "videos.deletions";
const VIDEO_DELETION_JOB_RETENTION_SECONDS = 86_400;
const VIDEO_DELETION_JOB_TIMEOUT_SECONDS = 300;
const VIDEO_DELETION_RETRY_INITIAL_DELAY_SECONDS = 30;
const VIDEO_DELETION_RETRY_MAX_DELAY_SECONDS = 300;
const VIDEO_DELETION_RETRY_LIMIT = 5;
const VIDEO_DELETION_SCHEDULE = "* * * * *";
const VIDEO_DELETION_SINGLETON_SECONDS = 60;

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(
    VideoDeletionsWorkerModule.forRoot(),
  );
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  const maintenance = application.get<VideoDeletionMaintenance>(
    VIDEO_DELETION_MAINTENANCE,
  );
  const materials = application.get<MaterialContent>(MATERIAL_CONTENT);
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
    process: "video-deletions-worker",
    readiness,
    async registerJobs() {
      await jobs.createQueue(DELETION_QUEUE, {
        deleteAfterSeconds: VIDEO_DELETION_JOB_RETENTION_SECONDS,
        expireInSeconds: VIDEO_DELETION_JOB_TIMEOUT_SECONDS,
        retryBackoff: true,
        retryDelay: VIDEO_DELETION_RETRY_INITIAL_DELAY_SECONDS,
        retryDelayMax: VIDEO_DELETION_RETRY_MAX_DELAY_SECONDS,
        retryLimit: VIDEO_DELETION_RETRY_LIMIT,
      });
      await jobs.schedule(DELETION_QUEUE, VIDEO_DELETION_SCHEDULE, {});
      await jobs.send(DELETION_QUEUE, {}, {
        singletonSeconds: VIDEO_DELETION_SINGLETON_SECONDS,
      });
      await jobs.work(DELETION_QUEUE, async () => {
        const result = await maintenance.process({
          async isReferenced(input) {
            const reference = await materials.containsVideoReference(input);
            if (!reference.ok) throw new Error(reference.error.code);
            return reference.value;
          },
        });
        if (!result.ok) throw new Error(result.error.code);
        return result;
      });
    },
  });
}
