import "server-only";

import type { LogtoNextConfig } from "@logto/next";

import {
  parseWebRuntimeConfig,
  readWebRuntimeConfig,
  type WebRuntimeConfig,
} from "@/shared/config/index.server";

export type ResolvedLogtoBffConfig = LogtoNextConfig & {
  readonly appSecret: string;
  readonly audience: string;
  readonly cookieSecret: string;
  readonly resources: string[];
};

export function parseLogtoBffConfig(
  environment: NodeJS.ProcessEnv,
  embeddedIdentity?: Parameters<typeof parseWebRuntimeConfig>[1],
): ResolvedLogtoBffConfig {
  return resolveLogtoBffConfig(
    parseWebRuntimeConfig(environment, embeddedIdentity),
  );
}

export function readLogtoBffConfig(): ResolvedLogtoBffConfig {
  return resolveLogtoBffConfig(readWebRuntimeConfig());
}

function resolveLogtoBffConfig(
  config: WebRuntimeConfig,
): ResolvedLogtoBffConfig {
  const resources = [config.identity.audience];
  Object.freeze(resources);
  return Object.freeze({
    endpoint: config.identity.endpoint,
    appId: config.identity.appId,
    appSecret: config.identity.appSecret,
    audience: config.identity.audience,
    cookieSecret: config.identity.cookieSecret,
    cookieSecure: config.mode === "production",
    baseUrl: config.identity.baseUrl,
    resources,
  });
}

export function logtoSessionCookieName(appId: string): string {
  if (appId.trim().length === 0) {
    throw new TypeError("Logto application id must not be empty");
  }
  return `logto_${appId}`;
}

export function hasLogtoSessionCookie(
  cookieNames: readonly string[],
  appId: string,
): boolean {
  return cookieNames.includes(logtoSessionCookieName(appId));
}
