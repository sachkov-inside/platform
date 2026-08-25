import "server-only";

const LOCAL_BACKEND_BASE_URL = "http://127.0.0.1:3001";
const BACKEND_REQUEST_TIMEOUT_MS = 3_000;

export type BackendConnectionErrorCode =
  | "backend-error"
  | "configuration"
  | "invalid-response"
  | "unavailable";

export class BackendConnectionError extends Error {
  readonly code: BackendConnectionErrorCode;

  constructor(
    code: BackendConnectionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BackendConnectionError";
    this.code = code;
  }
}

export interface BackendHealth {
  readonly process: "api";
  readonly status: "ok";
  readonly database: "reachable";
}

export function readBackendBaseUrl(): string {
  const configuredUrl = nonEmpty(process.env.BACKEND_BASE_URL?.trim());

  if (!configuredUrl && process.env.NODE_ENV === "production") {
    throw new BackendConnectionError(
      "configuration",
      "BACKEND_BASE_URL is required in production",
    );
  }

  const rawUrl = configuredUrl ?? LOCAL_BACKEND_BASE_URL;
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new BackendConnectionError(
      "configuration",
      "BACKEND_BASE_URL must be an absolute URL",
      { cause },
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BackendConnectionError(
      "configuration",
      "BACKEND_BASE_URL must use HTTP or HTTPS",
    );
  }

  return url.toString().replace(/\/$/u, "");
}

export async function requestBackend(path: `/${string}`): Promise<Response> {
  const baseUrl = readBackendBaseUrl();

  try {
    return await fetch(`${baseUrl}${path}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(BACKEND_REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new BackendConnectionError("unavailable", "Backend request failed", { cause });
  }
}

export async function getBackendHealth(): Promise<BackendHealth> {
  const response = await requestBackend("/health");

  if (!response.ok) {
    throw new BackendConnectionError(
      "unavailable",
      `Backend health request returned ${String(response.status)}`,
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch (cause) {
    throw new BackendConnectionError(
      "invalid-response",
      "Backend health response is not valid JSON",
      { cause },
    );
  }

  if (!isBackendHealth(payload)) {
    throw new BackendConnectionError(
      "invalid-response",
      "Backend health response does not match the contract",
    );
  }

  return payload;
}

function isBackendHealth(value: unknown): value is BackendHealth {
  if (!isRecord(value)) {
    return false;
  }

  return (
    value.process === "api" &&
    value.status === "ok" &&
    value.database === "reachable"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return value;
}
