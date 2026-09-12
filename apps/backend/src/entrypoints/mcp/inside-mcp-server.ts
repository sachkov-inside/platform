import type { McpServer } from "@modelcontextprotocol/server";

import { registerBillingTools, type BillingOwnerTools } from "../../modules/billing/index.js";
import {
  registerCommunicationsTools,
  type Communications,
} from "../../modules/communications/index.js";
import {
  assembleMaterialAuthoringMcpServer,
  type MaterialAuthoring,
} from "../../modules/materials/index.js";
import { registerVideoTools, type VideoAuthoringTools } from "../../modules/videos/index.js";

export interface InsideMcpToolDependencies {
  readonly accountId: string;
  readonly authoring: MaterialAuthoring;
  readonly videos: VideoAuthoringTools;
  readonly communications: Pick<Communications, "execute">;
  readonly billing: BillingOwnerTools;
}

/**
 * Один состав инструментов MCP для делегированного Account. HTTP-вход и слепок набора собирают
 * сервер этой функцией, поэтому список зарегистрированных инструментов существует в одном месте.
 */
export function assembleInsideMcpServer(dependencies: InsideMcpToolDependencies): McpServer {
  const { accountId } = dependencies;
  const server = assembleMaterialAuthoringMcpServer({ accountId, authoring: dependencies.authoring });
  registerVideoTools(server, { accountId, videos: dependencies.videos });
  registerCommunicationsTools(server, { accountId, communications: dependencies.communications });
  registerBillingTools(server, { accountId, billing: dependencies.billing });
  return server;
}
