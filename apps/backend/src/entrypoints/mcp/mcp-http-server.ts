import { createServer, type Server as NodeHttpServer } from "node:http";

import {
  hostHeaderValidation,
  originValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  requireBearerAuth,
  resourceUrlFromServerUrl,
  type OAuthProtectedResourceMetadata,
} from "@modelcontextprotocol/server";

import type { McpConfig } from "../../config/mcp-config.js";
import { PRIVATE_NO_STORE_HEADERS } from "../../infrastructure/http/http-cache-policy.js";
import type { OperationalReadiness } from "../../infrastructure/operational-readiness.js";
import {
  assembleDelegatedAccountTokenVerifier,
  type Accounts,
  type LogtoAccessTokenVerifier,
} from "../../modules/accounts/index.js";
import {
  assembleMaterialAuthoringMcpServer,
  type MaterialAuthoring,
} from "../../modules/materials/index.js";

export interface McpHttpServer {
  listen(): Promise<URL>;
  close(): Promise<void>;
}

export function createMcpHttpServer(dependencies: {
  readonly accounts: Accounts;
  readonly authoring: MaterialAuthoring;
  readonly config: McpConfig;
  readonly identityIssuer: string;
  readonly readiness: Pick<OperationalReadiness, "check" | "live">;
  readonly tokenVerifier: LogtoAccessTokenVerifier;
  readonly onError?: (error: Error) => void;
}): McpHttpServer {
  const configuredUrl = new URL(dependencies.config.serverUrl);
  const metadataUrl = getOAuthProtectedResourceMetadataUrl(configuredUrl);
  const verifier = assembleDelegatedAccountTokenVerifier(dependencies);
  const authenticate = requireBearerAuth({
    verifier,
    resourceMetadataUrl: metadataUrl,
  });
  const handler = createMcpHandler(
    ({ authInfo }) =>
      assembleMaterialAuthoringMcpServer({
        accountId: authenticatedAccountId(authInfo?.extra),
        authoring: dependencies.authoring,
      }),
    { responseMode: "json" },
  );
  const metadata: OAuthProtectedResourceMetadata = {
    resource: resourceUrlFromServerUrl(configuredUrl).href,
    authorization_servers: [dependencies.identityIssuer],
    bearer_methods_supported: ["header"],
    resource_name: "Sachkov Inside Platform Material authoring",
  };
  const fetchHandler = {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/_health/live") {
        return healthResponse(request, () =>
          Promise.resolve(dependencies.readiness.live("mcp")),
        );
      }
      if (url.pathname === "/_health/ready") {
        return healthResponse(request, () =>
          dependencies.readiness.check("mcp"),
        );
      }
      if (url.pathname === new URL(metadataUrl).pathname) {
        return resourceMetadataResponse(request, metadata);
      }
      if (url.pathname !== configuredUrl.pathname) {
        return new Response("Not found", { status: 404 });
      }
      const auth = await authenticate(request);
      return auth instanceof Response
        ? auth
        : handler.fetch(request, { authInfo: auth });
    },
  };
  const nodeHandler = toNodeHandler(
    fetchHandler,
    dependencies.onError === undefined
      ? {}
      : { onerror: dependencies.onError },
  );
  const allowedHostnames = [
    configuredUrl.hostname,
    "127.0.0.1",
    "localhost",
    "::1",
  ];
  const validateHost = hostHeaderValidation(allowedHostnames);
  const validateOrigin = originValidation(allowedHostnames);
  const server = createServer((request, response) => {
    if (
      !validateHost(request, response) ||
      !validateOrigin(request, response)
    ) {
      return;
    }
    const completeRequest = Object.assign(request, {
      method: request.method ?? "GET",
      url: request.url ?? "/",
    });
    void nodeHandler(completeRequest, response);
  });

  return {
    listen: () => listen(server, dependencies.config, configuredUrl),
    async close() {
      const stopListening = closeNodeServer(server);
      await Promise.all([handler.close(), stopListening]);
    },
  };
}

async function healthResponse(
  request: Request,
  report: () => Promise<unknown>,
): Promise<Response> {
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...PRIVATE_NO_STORE_HEADERS, allow: "GET" },
    });
  }
  try {
    return Response.json(await report(), {
      headers: PRIVATE_NO_STORE_HEADERS,
    });
  } catch {
    return Response.json(
      { code: "dependency_unavailable", status: 503 },
      {
        status: 503,
        headers: PRIVATE_NO_STORE_HEADERS,
      },
    );
  }
}

function authenticatedAccountId(extra: Record<string, unknown> | undefined): string {
  const accountId = extra?.accountId;
  if (typeof accountId !== "string") {
    throw new Error("Authenticated MCP request has no resolved Account");
  }
  return accountId;
}

function resourceMetadataResponse(
  request: Request,
  metadata: OAuthProtectedResourceMetadata,
): Response {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: resourceMetadataHeaders(),
    });
  }
  if (request.method !== "GET") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...resourceMetadataHeaders(), allow: "GET, OPTIONS" },
    });
  }
  return Response.json(metadata, { headers: resourceMetadataHeaders() });
}

function resourceMetadataHeaders(): Record<string, string> {
  return {
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-origin": "*",
    "cache-control": "public, max-age=300",
  };
}

async function listen(
  server: NodeHttpServer,
  config: McpConfig,
  configuredUrl: URL,
): Promise<URL> {
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(config.port, config.host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("MCP HTTP server has no TCP address");
  }
  const listeningUrl = new URL(configuredUrl);
  if (config.port === 0) {
    listeningUrl.port = String(address.port);
  }
  return listeningUrl;
}

function closeNodeServer(server: NodeHttpServer): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
