import { PgBoss } from "pg-boss";
import { reportQueueFailure } from "../../../../infrastructure/observability/index.js";
import type { ReviewQueue } from "../../ports/review-queue.js";

/** Очередь pg-boss, которую слушает `course-assistant-worker`; worker её и создаёт. */
export const PRACTICE_REVIEW_QUEUE = "course-assistant.practice-reviews";

/**
 * Постановка проверки из API. API только отправляет задания: схему pg-boss создаёт миграция, очередь
 * — worker, а обслуживание очереди в этом процессе выключено.
 */
export class PgBossReviewQueue implements ReviewQueue {
  private started: Promise<PgBoss> | undefined;

  constructor(private readonly databaseUrl: string) {}

  async enqueue(reviewId: string): Promise<void> {
    const jobs = await this.jobs();
    await jobs.send(PRACTICE_REVIEW_QUEUE, { reviewId });
  }

  async stop(): Promise<void> {
    const started = this.started;
    this.started = undefined;
    if (started !== undefined) await (await started).stop({ graceful: false });
  }

  private jobs(): Promise<PgBoss> {
    this.started ??= this.start().catch((error: unknown) => {
      // Следующая постановка попробует подключиться заново.
      this.started = undefined;
      throw error;
    });
    return this.started;
  }

  private async start(): Promise<PgBoss> {
    const jobs = new PgBoss({
      connectionString: this.databaseUrl,
      createSchema: false,
      migrate: false,
      schedule: false,
      supervise: false,
      schema: "pgboss",
      max: 2,
    });
    jobs.on("error", (error: unknown) => reportQueueFailure("api", error));
    await jobs.start();
    return jobs;
  }
}
