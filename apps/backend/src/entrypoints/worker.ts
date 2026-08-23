import "reflect-metadata";

import { readDatabaseConfig } from "../config/database.js";
import { runRuntimeProcess } from "./run-runtime-process.js";

async function bootstrap(): Promise<void> {
  const { PgBoss } = await import("pg-boss");
  const boss = new PgBoss(readDatabaseConfig().url);

  boss.on("error", (error) => console.error(error));
  await boss.start();

  try {
    await runRuntimeProcess("worker");
  } finally {
    await boss.stop();
  }
}

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
