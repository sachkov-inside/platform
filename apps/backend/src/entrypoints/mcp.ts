import "reflect-metadata";

import { loadMcpConfig } from "../config/mcp-config.js";
import { loadPlatformConfig } from "../config/load-platform-config.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import {
  ACCOUNTS,
  LOGTO_ACCESS_TOKEN_VERIFIER,
  type Accounts,
  type LogtoAccessTokenVerifier,
} from "../modules/accounts/index.js";
import {
  MATERIAL_AUTHORING,
  type MaterialAuthoring,
} from "../modules/materials/index.js";
import { createMcpApplication } from "./create-mcp-application.js";
import { createMcpHttpServer } from "./mcp/mcp-http-server.js";

void bootstrap().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function bootstrap(): Promise<void> {
  const config = loadPlatformConfig();
  const mcpConfig = loadMcpConfig(config.mode);
  const application = await createMcpApplication(config);
  const shutdown = listenForShutdownSignal();
  const server = createMcpHttpServer({
    accounts: application.get<Accounts>(ACCOUNTS),
    authoring: application.get<MaterialAuthoring>(MATERIAL_AUTHORING),
    config: mcpConfig,
    identityIssuer: config.identity.issuer,
    tokenVerifier: application.get<LogtoAccessTokenVerifier>(
      LOGTO_ACCESS_TOKEN_VERIFIER,
    ),
    onError: (error) => console.error(error),
  });

  try {
    const readiness = application.get(OperationalReadiness);
    console.info(JSON.stringify(await readiness.check("mcp")));
    const endpoint = await server.listen();
    console.info(`MCP listening on ${endpoint.href}`);
    await shutdown.received;
  } finally {
    shutdown.dispose();
    await server.close();
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
