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
  const shutdown = listenForShutdownSignal();

  try {
    const readiness = app.get(OperationalReadiness);
    const report = await readiness.check(processName);

    console.info(JSON.stringify(report));
    await shutdown.received;
  } finally {
    shutdown.dispose();
    await app.close();
  }
}

function listenForShutdownSignal(): {
  readonly received: Promise<void>;
  dispose(): void;
} {
  let resolveSignal: () => void = () => {};
  const received = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  const dispose = (): void => {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  };
  const onSignal = (): void => {
    dispose();
    resolveSignal();
  };

  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  return { received, dispose };
}
