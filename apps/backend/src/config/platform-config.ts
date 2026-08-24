const DEFAULT_DATABASE_URL =
  "postgresql://inside:inside@127.0.0.1:5432/inside";
const DEFAULT_API_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "3001";

export const PLATFORM_CONFIG = Symbol("PLATFORM_CONFIG");

export type PlatformMode = "development" | "test" | "production";

export interface PlatformConfig {
  readonly mode: PlatformMode;
  readonly database: Readonly<{
    url: string;
  }>;
  readonly api: Readonly<{
    host: string;
    port: number;
  }>;
}

function parseMode(value: string | undefined): PlatformMode {
  const mode = value ?? "production";
  if (mode === "development" || mode === "test" || mode === "production") {
    return mode;
  }

  throw new Error("NODE_ENV must be development, test, or production");
}

function readRuntimeValue(
  environment: NodeJS.ProcessEnv,
  name: "DATABASE_URL" | "API_HOST" | "API_PORT",
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

function validateDatabaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(
      "DATABASE_URL must use the postgres or postgresql protocol",
    );
  }

  return value;
}

function parseApiPort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  return port;
}

export function parsePlatformConfig(
  environment: NodeJS.ProcessEnv,
): PlatformConfig {
  const mode = parseMode(environment.NODE_ENV);
  const database = Object.freeze({
    url: validateDatabaseUrl(
      readRuntimeValue(
        environment,
        "DATABASE_URL",
        mode,
        DEFAULT_DATABASE_URL,
      ),
    ),
  });
  const api = Object.freeze({
    host: readRuntimeValue(environment, "API_HOST", mode, DEFAULT_API_HOST),
    port: parseApiPort(
      readRuntimeValue(environment, "API_PORT", mode, DEFAULT_API_PORT),
    ),
  });

  return Object.freeze({ mode, database, api });
}
