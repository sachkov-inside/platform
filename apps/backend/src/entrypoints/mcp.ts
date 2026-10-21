import { ParticipantDiagnostics } from "./mcp/participant-diagnostics.js";
import { QueueDiagnostics } from "./mcp/queue-diagnostics.js";
import { SalesFunnel } from "../modules/sales-funnel/index.js";
import { WebTelemetry } from "../modules/web-telemetry/index.js";
import { VIDEOS, type Videos } from "../modules/videos/index.js";
import {
  BillingOperations,
  PaymentDiagnostics,
} from "../modules/billing/index.js";
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
  PUBLISHED_MATERIAL_READER,
  type PublishedMaterialReader,
  MATERIAL_AUTHORING,
  type MaterialAuthoring,
} from "../modules/materials/index.js";
import {
  CONTENT_ACCESS,
  type ContentAccess,
} from "../modules/content-access/index.js";
import {
  LEARNING_TASKS,
  type LearningTasks,
} from "../modules/product-tasks/index.js";
import { createMcpApplication } from "./create-mcp-application.js";
import {
  RUNTIME_IDENTITY,
  type RuntimeIdentity,
} from "../infrastructure/runtime-identity.js";
import { technicalTelemetryFromEnvironment } from "../infrastructure/observability/technical-telemetry-runtime.js";
import {
  createMcpHttpServer,
  type McpHttpServer,
} from "./mcp/mcp-http-server.js";

void bootstrap().catch((error: unknown) => reportProcessFailure("mcp", error));

async function bootstrap(): Promise<void> {
  const application = await createMcpApplication();
  const config = application.get<PlatformConfig>(PLATFORM_CONFIG);
  const mcpConfig = parseMcpConfig(process.env, config.mode);
  const shutdown = listenForProcessShutdown();
  const technicalTelemetry = technicalTelemetryFromEnvironment({
    environment: process.env,
    service: "platform-mcp",
    mode: config.mode,
    identity: application.get<RuntimeIdentity>(RUNTIME_IDENTITY),
  });
  let server: McpHttpServer | undefined;
  try {
    server = createMcpHttpServer({
      technicalTelemetry,
      accounts: application.get<Accounts>(ACCOUNTS),
      learning: {
        reader: application.get<PublishedMaterialReader>(
          PUBLISHED_MATERIAL_READER,
        ),
        contentAccess: application.get<ContentAccess>(CONTENT_ACCESS),
        videos: application.get<Videos>(VIDEOS),
        tasks: application.get<LearningTasks>(LEARNING_TASKS),
      },
      authoring: application.get<MaterialAuthoring>(MATERIAL_AUTHORING),
      videos: application.get<Videos>(VIDEOS),
      communications: application.get(Communications),
      billing: application.get(BillingOperations),
      diagnostics: application.get(PaymentDiagnostics),
      funnel: application.get(SalesFunnel),
      queues: application.get(QueueDiagnostics),
      participants: application.get(ParticipantDiagnostics),
      telemetry: application.get(WebTelemetry),
      config: mcpConfig,
      identityIssuer: config.identity.issuer,
      readiness: application.get(OperationalReadiness),
      tokenVerifier: application.get<LogtoAccessTokenVerifier>(
        LOGTO_ACCESS_TOKEN_VERIFIER,
      ),
      onError: (error) =>
        writeLog("error", "request_failed", { error: describeError(error) }),
    });

    writeLog("info", "process_ready", {
      ...(await application.get(OperationalReadiness).check("mcp")),
    });
    const endpoint = await server.listen();
    writeLog("info", "mcp_listening", {
      process: "mcp",
      endpoint: endpoint.href,
    });
    await shutdown.received;
  } finally {
    shutdown.dispose();
    try {
      await server?.close();
    } finally {
      await technicalTelemetry.shutdown();
      await application.close();
    }
  }
}
