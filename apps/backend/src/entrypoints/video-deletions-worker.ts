import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
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
  const jobs = new PgBoss({
    connectionString: config.database.url,
    createSchema: false,
    migrate: false,
    schema: "pgboss",
  });
  jobs.on("error", (error) => console.error(error));
  const shutdown = waitForShutdownSignal();
  try {
    await jobs.start();
    await jobs.createQueue(DELETION_QUEUE, {
      deleteAfterSeconds: 86_400,
      expireInSeconds: 300,
      retryBackoff: true,
      retryDelay: 30,
      retryDelayMax: 300,
      retryLimit: 5,
    });
    await jobs.schedule(DELETION_QUEUE, "* * * * *", {});
    await jobs.send(DELETION_QUEUE, {}, { singletonSeconds: 60 });
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
    console.info(JSON.stringify({ process: "video-deletions-worker", status: "ready" }));
    await shutdown.received;
  } finally {
    shutdown.dispose();
    await jobs.stop({ close: true, graceful: true, timeout: 10_000 });
    await application.close();
  }
}

function waitForShutdownSignal(): {
  readonly received: Promise<void>;
  dispose(): void;
} {
  let resolveSignal: (() => void) | undefined;
  const received = new Promise<void>((resolve) => { resolveSignal = resolve; });
  const dispose = (): void => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = (): void => {
    dispose();
    resolveSignal?.();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return { dispose, received };
}
