import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import { StructuredNestLogger, observeJob, reportProcessFailure, reportQueueFailure } from "../infrastructure/observability/index.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { runWorker } from "../infrastructure/worker-runtime.js";
import {
  PROFILE_AVATAR_MAINTENANCE,
  type ProfileAvatarMaintenance,
} from "../modules/member-profiles/index.js";
import { ProfileAvatarsWorkerModule } from "./profile-avatars-worker/profile-avatars-worker.module.js";

const CLEANUP_QUEUE = "profile-avatars.cleanup";
const CLEANUP_JOB_RETENTION_SECONDS = 86_400;
const CLEANUP_JOB_TIMEOUT_SECONDS = 300;
const CLEANUP_RETRY_INITIAL_DELAY_SECONDS = 30;
const CLEANUP_RETRY_MAX_DELAY_SECONDS = 300;
const CLEANUP_RETRY_LIMIT = 5;
const CLEANUP_SINGLETON_SECONDS = 3_600;

void bootstrap().catch((error: unknown) => reportProcessFailure("profile-avatars-worker", error));

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(
    ProfileAvatarsWorkerModule.forRoot(), { logger: new StructuredNestLogger() },
  );
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  const maintenance = application.get<ProfileAvatarMaintenance>(
    PROFILE_AVATAR_MAINTENANCE,
  );
  const readiness = application.get(OperationalReadiness);
  const jobs = new PgBoss({
    connectionString: config.database.url,
    createSchema: false,
    migrate: false,
    schema: "pgboss",
  });
  jobs.on("error", (error: unknown) => reportQueueFailure("profile-avatars-worker", error));
  await runWorker({
    application,
    databaseUrl: config.database.url,
    jobs,
    process: "profile-avatars-worker",
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
      await jobs.schedule(CLEANUP_QUEUE, "23 * * * *", {});
      await jobs.send(CLEANUP_QUEUE, {}, {
        singletonSeconds: CLEANUP_SINGLETON_SECONDS,
      });
      await jobs.work(CLEANUP_QUEUE, observeJob("profile-avatars-worker", CLEANUP_QUEUE, async () =>
        maintenance.cleanup({
          graceMs: config.objectStorage.profileAvatarOrphanGraceMs,
        })),
      );
    },
  });
}
