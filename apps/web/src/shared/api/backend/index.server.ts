import "server-only";

import { z } from "zod";

const LOCAL_BACKEND_BASE_URL = "http://127.0.0.1:3001";
const BACKEND_REQUEST_TIMEOUT_MS = 3_000;

export type BackendConnectionErrorCode =
  | "backend-error"
  | "configuration"
  | "invalid-response"
  | "rejected"
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

const authenticatedAccountSchema = z.object({ accountId: z.uuid() }).strict();
const accountResponseSchema = z
  .object({ account: authenticatedAccountSchema })
  .strict();
export type AuthenticatedAccount = Readonly<
  z.infer<typeof authenticatedAccountSchema>
>;

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

export async function requestBackend(
  path: `/${string}`,
  options: Pick<RequestInit, "headers" | "method" | "signal"> = {},
): Promise<Response> {
  const baseUrl = readBackendBaseUrl();
  const { signal, ...init } = options;

  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      signal: combineAbortSignals(signal),
    });
  } catch (cause) {
    throw new BackendConnectionError("unavailable", "Backend request failed", { cause });
  }
}

function combineAbortSignals(signal: AbortSignal | null | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(BACKEND_REQUEST_TIMEOUT_MS);
  return signal === undefined || signal === null
    ? timeout
    : AbortSignal.any([signal, timeout]);
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

export async function establishAccount(
  accessToken: string,
): Promise<AuthenticatedAccount> {
  return requestAccount("/accounts", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

export async function resolveAccount(
  accessToken: string,
): Promise<AuthenticatedAccount> {
  return requestAccount("/accounts/current", {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
}

async function requestAccount(
  path: `/${string}`,
  init: Pick<RequestInit, "headers" | "method">,
): Promise<AuthenticatedAccount> {
  const response = await requestBackend(path, init);
  if (!response.ok) {
    throw new BackendConnectionError(
      response.status >= 500 ? "unavailable" : "rejected",
      `Backend Account request returned ${String(response.status)}`,
    );
  }
  const payload = await readJson(response);
  const parsed = accountResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw invalidBackendResponse("Account response does not match the contract");
  }
  return parsed.data.account;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw invalidBackendResponse("Backend Account response is not valid JSON", cause);
  }
}

function invalidBackendResponse(message: string, cause?: unknown): BackendConnectionError {
  return new BackendConnectionError("invalid-response", message, { cause });
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
