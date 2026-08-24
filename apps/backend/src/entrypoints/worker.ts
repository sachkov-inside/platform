import "reflect-metadata";

import { loadPlatformConfig } from "../config/load-platform-config.js";
import { runRuntimeProcess } from "./run-runtime-process.js";

async function bootstrap(): Promise<void> {
  const config = loadPlatformConfig();
  const { PgBoss } = await import("pg-boss");
  const pgBoss = new PgBoss(config.database.url);

  pgBoss.on("error", (error) => console.error(error));
  await pgBoss.start();

  try {
    await runRuntimeProcess("worker", config);
  } finally {
    await pgBoss.stop();
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
