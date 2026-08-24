import type { PlatformConfig } from "../config/platform-config.js";
import {
  OperationalReadiness,
  type RuntimeProcess,
} from "../infrastructure/operational-readiness.js";
import { createRuntimeApplication } from "./create-runtime-application.js";

export async function runRuntimeProcess(
  processName: RuntimeProcess,
  config: PlatformConfig,
): Promise<void> {
  const app = await createRuntimeApplication(config);

  try {
    const readiness = app.get(OperationalReadiness);
    const report = await readiness.check(processName);

    console.info(JSON.stringify(report));

    await new Promise<void>((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } finally {
    await app.close();
  }
}
