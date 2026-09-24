import { VIDEOS, type Videos } from "../modules/videos/index.js";
import { BillingOperations } from "../modules/billing/index.js";
import { Communications } from "../modules/communications/index.js";
import "reflect-metadata";

import { parseMcpConfig } from "../config/mcp-config.js";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../config/platform-config.js";
import {
  describeError,
  reportProcessFailure,
  writeLog,
} from "../infrastructure/observability/index.js";
import { OperationalReadiness } from "../infrastructure/operational-readiness.js";
import { listenForProcessShutdown } from "../infrastructure/process-shutdown.js";
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

void bootstrap().catch((error: unknown) => reportProcessFailure("mcp", error));

async function bootstrap(): Promise<void> {
  const application = await createMcpApplication();
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  const mcpConfig = parseMcpConfig(process.env, config.mode);
  const shutdown = listenForProcessShutdown();
  const server = createMcpHttpServer({
    accounts: application.get<Accounts>(ACCOUNTS),
    authoring: application.get<MaterialAuthoring>(MATERIAL_AUTHORING),
      videos: application.get<Videos>(VIDEOS),
    communications: application.get(Communications),
    billing: application.get(BillingOperations),
    config: mcpConfig,
    identityIssuer: config.identity.issuer,
    readiness: application.get(OperationalReadiness),
    tokenVerifier: application.get<LogtoAccessTokenVerifier>(
      LOGTO_ACCESS_TOKEN_VERIFIER,
    ),
    onError: (error) => writeLog("error", "request_failed", { error: describeError(error) }),
  });

  try {
    writeLog("info", "process_ready", { ...(await application.get(OperationalReadiness).check("mcp")) });
    const endpoint = await server.listen();
    writeLog("info", "mcp_listening", { process: "mcp", endpoint: endpoint.href });
    await shutdown.received;
  } finally {
    shutdown.dispose();
    await server.close();
    await application.close();
  }
}
