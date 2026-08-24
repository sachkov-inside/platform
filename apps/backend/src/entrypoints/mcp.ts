import "reflect-metadata";

import { loadPlatformConfig } from "../config/load-platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { createMcpApplication } from "./create-mcp-application.js";

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function bootstrap(): Promise<void> {
  const application = await createMcpApplication(loadPlatformConfig());
  const shutdown = listenForShutdownSignal();

  try {
    const readiness = application.get(OperationalReadiness);
    console.info(JSON.stringify(await readiness.check("mcp")));
    await shutdown.received;
  } finally {
    shutdown.dispose();
    await application.close();
  }
}

function listenForShutdownSignal(): {
  readonly received: Promise<void>;
  dispose(): void;
} {
  let resolveSignal: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
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

  return { received, dispose };
}
