import { z } from "zod";

import type { PlatformMode } from "./platform-config.js";

const DEFAULT_MCP_HOST = "127.0.0.1";
const DEFAULT_MCP_PORT = "3002";
const DEFAULT_MCP_SERVER_URL = "http://127.0.0.1:3002/mcp";
const hostnameSchema = z.string().trim().min(1).max(253);

export interface McpConfig {
  readonly host: string;
  readonly port: number;
  readonly serverUrl: string;
}

export function parseMcpConfig(
  environment: NodeJS.ProcessEnv,
  mode: PlatformMode,
): McpConfig {
  const host = hostnameSchema.safeParse(
    runtimeValue(environment, "MCP_HOST", mode, DEFAULT_MCP_HOST),
  );
  if (!host.success) {
    throw new Error("MCP_HOST must be a hostname or listen address");
  }

  const port = Number(
    runtimeValue(environment, "MCP_PORT", mode, DEFAULT_MCP_PORT),
  );
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("MCP_PORT must be an integer between 1 and 65535");
  }

  const serverUrl = parseServerUrl(
    runtimeValue(
      environment,
      "MCP_SERVER_URL",
      mode,
      DEFAULT_MCP_SERVER_URL,
    ),
    mode,
  );

  return Object.freeze({ host: host.data, port, serverUrl });
}

function runtimeValue(
  environment: NodeJS.ProcessEnv,
  name: "MCP_HOST" | "MCP_PORT" | "MCP_SERVER_URL",
  mode: PlatformMode,
  localDefault: string,
): string {
  const value = environment[name]?.trim();
  if (value !== undefined && value.length > 0) {
    return value;
  }
  if (mode !== "production") {
    return localDefault;
  }
  throw new Error(`${name} is required in production mode`);
}

function parseServerUrl(value: string, mode: PlatformMode): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("MCP_SERVER_URL must be an absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("MCP_SERVER_URL must use HTTP or HTTPS");
  }
  if (mode === "production" && url.protocol !== "https:") {
    throw new Error("MCP_SERVER_URL must use HTTPS in production mode");
  }
  if (
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "MCP_SERVER_URL must not contain credentials, query, or fragment",
    );
  }
  if (url.pathname === "/" || url.pathname.endsWith("/")) {
    throw new Error("MCP_SERVER_URL must contain a non-trailing endpoint path");
  }
  return url.href;
}
