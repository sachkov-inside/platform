import "server-only";

import type { LogtoNextConfig } from "@logto/next";

type RuntimeMode = "development" | "production" | "test";

export type ResolvedLogtoBffConfig = LogtoNextConfig & {
  readonly appSecret: string;
  readonly audience: string;
  readonly cookieSecret: string;
  readonly resources: string[];
};

const localDefaults = {
  LOGTO_ENDPOINT: "https://identity.inside.localhost:3301",
  LOGTO_AUDIENCE: "http://127.0.0.1:3001",
  LOGTO_APP_ID: "inside-web-local",
  LOGTO_APP_SECRET: "inside-web-local-confidential-secret",
  LOGTO_COOKIE_SECRET: "inside-local-logto-cookie-secret-key",
  WEB_BASE_URL: "http://127.0.0.1:3000",
} as const;

export function parseLogtoBffConfig(
  environment: NodeJS.ProcessEnv,
): ResolvedLogtoBffConfig {
  const mode = runtimeMode(environment.NODE_ENV);
  const endpoint = readValue(environment, "LOGTO_ENDPOINT", mode);
  const audience = readValue(environment, "LOGTO_AUDIENCE", mode);
  const appId = readValue(environment, "LOGTO_APP_ID", mode);
  const appSecret = readValue(environment, "LOGTO_APP_SECRET", mode);
  const cookieSecret = readValue(environment, "LOGTO_COOKIE_SECRET", mode);
  const baseUrl = readValue(environment, "WEB_BASE_URL", mode);

  validateUrl(endpoint, "LOGTO_ENDPOINT", true);
  validateUrl(audience, "LOGTO_AUDIENCE", false);
  validateUrl(baseUrl, "WEB_BASE_URL", mode === "production");
  if (appSecret.length < 16) {
    throw new Error("LOGTO_APP_SECRET must contain at least 16 characters");
  }
  if (cookieSecret.length < 32) {
    throw new Error("LOGTO_COOKIE_SECRET must contain at least 32 characters");
  }

  const resources = [audience];
  Object.freeze(resources);
  return Object.freeze({
    endpoint,
    appId,
    appSecret,
    audience,
    cookieSecret,
    cookieSecure: mode === "production",
    baseUrl,
    resources,
  });
}

export function readLogtoBffConfig(): ResolvedLogtoBffConfig {
  return parseLogtoBffConfig(process.env);
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

function runtimeMode(value: string | undefined): RuntimeMode {
  if (value === "development" || value === "test" || value === "production") {
    return value;
  }
  return "production";
}

function readValue(
  environment: NodeJS.ProcessEnv,
  name: keyof typeof localDefaults,
  mode: RuntimeMode,
): string {
  const value = environment[name]?.trim();
  if (value !== undefined && value.length > 0) {
    return value;
  }
  if (mode !== "production") {
    return localDefaults[name];
  }
  throw new Error(`${name} is required in production mode`);
}

function validateUrl(value: string, name: string, requireHttps: boolean): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTP or HTTPS`);
  }
  if (requireHttps && url.protocol !== "https:") {
    throw new Error(`${name} must use HTTPS`);
  }
}
