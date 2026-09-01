import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import { PgBoss } from "pg-boss";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import {
  MATERIAL_ASSET_MAINTENANCE,
  type MaterialAssetMaintenance,
} from "../modules/materials/index.js";
import { MaterialAssetsWorkerModule } from "./material-assets-worker/material-assets-worker.module.js";

const CLEANUP_QUEUE = "material-assets.cleanup";

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
    await jobs.createQueue(CLEANUP_QUEUE, {
      deleteAfterSeconds: 86_400,
      expireInSeconds: 300,
      retryBackoff: true,
      retryDelay: 30,
      retryDelayMax: 300,
      retryLimit: 5,
    });
    await jobs.schedule(CLEANUP_QUEUE, "17 * * * *", {});
    await jobs.send(CLEANUP_QUEUE, {}, {
      singletonSeconds: 3_600,
    });
    await jobs.work(CLEANUP_QUEUE, async () => {
      const result = await maintenance.cleanup();
      if (!result.ok) throw new Error(result.error.code);
      return result;
    });
    console.info(JSON.stringify({ process: "material-assets-worker", status: "ready" }));
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
