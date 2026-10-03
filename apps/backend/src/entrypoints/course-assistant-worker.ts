import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { PgBoss, type Job } from "pg-boss";
import { z } from "zod";

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
  PRACTICE_REVIEW_QUEUE,
  PracticeReviewer,
  runningReviewTimeoutMilliseconds,
} from "../modules/course-assistant/index.js";
import { CourseAssistantWorkerModule } from "./course-assistant-worker/course-assistant-worker.module.js";

const STALLED_REVIEWS_QUEUE = "course-assistant.stalled-reviews";
const REVIEW_JOB_RETENTION_SECONDS = 86_400;
/** Срок задания — тот же, после которого сторож закрывает проверку как прерванную. */
const REVIEW_JOB_TIMEOUT_SECONDS = runningReviewTimeoutMilliseconds / 1000;
const STALLED_REVIEWS_SCHEDULE = "* * * * *";
const STALLED_REVIEWS_SINGLETON_SECONDS = 60;
const reviewJobSchema = z.object({ reviewId: z.uuid() });

void bootstrap().catch((error: unknown) =>
  reportProcessFailure("course-assistant-worker", error),
);

async function bootstrap(): Promise<void> {
  const application = await NestFactory.createApplicationContext(
    CourseAssistantWorkerModule.forRoot(),
    { logger: new StructuredNestLogger() },
  );
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  const reviewer = application.get<PracticeReviewer | null>(PracticeReviewer);
  const readiness = application.get(OperationalReadiness);
  const jobs = new PgBoss({
    connectionString: config.database.url,
    createSchema: false,
    migrate: false,
    schema: "pgboss",
  });
  jobs.on("error", (error: unknown) =>
    reportQueueFailure("course-assistant-worker", error),
  );
  await runWorker({
    application,
    databaseUrl: config.database.url,
    jobs,
    process: "course-assistant-worker",
    readiness,
    async registerJobs() {
      if (reviewer === null) {
        writeLog("info", "course_assistant_reviews_disabled", {
          process: "course-assistant-worker",
        });
        return;
      }
      await reviewer.removeLeftoverSnapshots();
      await jobs.createQueue(PRACTICE_REVIEW_QUEUE, {
        deleteAfterSeconds: REVIEW_JOB_RETENTION_SECONDS,
        expireInSeconds: REVIEW_JOB_TIMEOUT_SECONDS,
        // Проверка не повторяется очередью: сбой пишется в неё самой, участник запускает заново.
        retryLimit: 0,
      });
      await jobs.createQueue(STALLED_REVIEWS_QUEUE, {
        deleteAfterSeconds: REVIEW_JOB_RETENTION_SECONDS,
        expireInSeconds: REVIEW_JOB_TIMEOUT_SECONDS,
        retryLimit: 0,
      });
      await jobs.schedule(STALLED_REVIEWS_QUEUE, STALLED_REVIEWS_SCHEDULE, {});
      await jobs.send(
        STALLED_REVIEWS_QUEUE,
        {},
        { singletonSeconds: STALLED_REVIEWS_SINGLETON_SECONDS },
      );
      await jobs.work(
        PRACTICE_REVIEW_QUEUE,
        observeJob(
          "course-assistant-worker",
          PRACTICE_REVIEW_QUEUE,
          async (batch: readonly Job<unknown>[]) => {
            for (const job of batch) {
              const { reviewId } = reviewJobSchema.parse(job.data);
              const result = await reviewer.run({ reviewId });
              if (!result.ok) throw new Error(result.error.code);
            }
          },
        ),
      );
      await jobs.work(
        STALLED_REVIEWS_QUEUE,
        observeJob(
          "course-assistant-worker",
          STALLED_REVIEWS_QUEUE,
          async () => {
            const result = await reviewer.resumeStalled();
            if (!result.ok) throw new Error(result.error.code);
            for (const reviewId of result.value.queued)
              await jobs.send(PRACTICE_REVIEW_QUEUE, { reviewId });
            return result.value;
          },
        ),
      );
    },
  });
}
