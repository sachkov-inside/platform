import {
  registerFunnelDiagnosticsTool,
  type SalesFunnel,
} from "../../modules/sales-funnel/index.js";
import {
  registerWebTelemetryTool,
  type WebTelemetry,
} from "../../modules/web-telemetry/index.js";
import type { McpServer } from "@modelcontextprotocol/server";

import {
  registerBillingTools,
  registerPaymentDiagnosticsTool,
  type PaymentDiagnostics,
  type BillingOwnerTools,
} from "../../modules/billing/index.js";
import {
  registerCommunicationsTools,
  type Communications,
} from "../../modules/communications/index.js";
import {
  assembleMaterialAuthoringMcpServer,
  type MaterialAuthoring,
} from "../../modules/materials/index.js";
import {
  registerVideoTools,
  type VideoAuthoringTools,
} from "../../modules/videos/index.js";

export interface InsideMcpToolDependencies {
  readonly accountId: string;
  readonly funnel: Pick<SalesFunnel, "readDiagnostics">;
  readonly authoring: MaterialAuthoring;
  readonly videos: VideoAuthoringTools;
  readonly communications: Pick<Communications, "execute">;
  readonly telemetry: Pick<WebTelemetry, "summary">;
  readonly billing: BillingOwnerTools;
  readonly diagnostics: Pick<PaymentDiagnostics, "read">;
}

/**
 * Один состав инструментов MCP для делегированного Account. HTTP-вход и слепок набора собирают
 * сервер этой функцией, поэтому список зарегистрированных инструментов существует в одном месте.
 */
export function assembleInsideMcpServer(
  dependencies: InsideMcpToolDependencies,
): McpServer {
  const { accountId } = dependencies;
  const server = assembleMaterialAuthoringMcpServer({
    accountId,
    authoring: dependencies.authoring,
  });
  registerVideoTools(server, { accountId, videos: dependencies.videos });
  registerCommunicationsTools(server, {
    accountId,
    communications: dependencies.communications,
  });
  registerFunnelDiagnosticsTool(server, {
    accountId,
    funnel: dependencies.funnel,
  });
  registerPaymentDiagnosticsTool(server, {
    accountId,
    diagnostics: dependencies.diagnostics,
  });
  registerBillingTools(server, { accountId, billing: dependencies.billing });
  registerWebTelemetryTool(server, {
    accountId,
    telemetry: dependencies.telemetry,
  });
  return server;
}
