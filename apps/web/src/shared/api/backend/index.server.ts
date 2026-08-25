import "server-only";

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

export interface IdentitySubject {
  readonly principalId: string;
  readonly principalKind: "human" | "service";
  readonly sessionRef: string;
  readonly authenticatedAt: string;
  readonly expiresAt: string;
  readonly permissions: readonly (
    | "identity:admin"
    | "materials:author"
    | "materials:publish"
  )[];
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

export async function requestBackend(
  path: `/${string}`,
  init: Pick<RequestInit, "headers" | "method"> = {},
): Promise<Response> {
  const baseUrl = readBackendBaseUrl();

  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
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

export async function establishIdentitySession(command: {
  readonly accessToken: string;
  readonly idempotencyKey: string;
}): Promise<IdentitySubject> {
  return requestIdentitySubject("/identity/sessions/human", {
    method: "POST",
    headers: {
      authorization: `Bearer ${command.accessToken}`,
      "idempotency-key": command.idempotencyKey,
    },
  });
}

export async function resolveIdentitySubject(query: {
  readonly accessToken: string;
  readonly sessionRef: string;
}): Promise<IdentitySubject> {
  return requestIdentitySubject("/identity/subject", {
    method: "GET",
    headers: {
      authorization: `Bearer ${query.accessToken}`,
      "x-platform-session": query.sessionRef,
    },
  });
}

export async function beginIdentityReauthentication(command: {
  readonly accessToken: string;
  readonly idempotencyKey: string;
  readonly sessionRef: string;
}): Promise<{ readonly attemptId: string; readonly expiresAt: string }> {
  const response = await requestIdentityBackend("/identity/reauthentication-attempts", {
    method: "POST",
    headers: identitySessionHeaders(command),
  });
  const payload = await readJson(response);
  if (
    !isRecord(payload) ||
    typeof payload.attemptId !== "string" ||
    typeof payload.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(payload.expiresAt))
  ) {
    throw invalidBackendResponse("Identity re-authentication response is invalid");
  }
  return { attemptId: payload.attemptId, expiresAt: payload.expiresAt };
}

export async function completeIdentityReauthentication(command: {
  readonly accessToken: string;
  readonly attemptId: string;
  readonly idempotencyKey: string;
  readonly sessionRef: string;
}): Promise<IdentitySubject> {
  return requestIdentitySubject(
    `/identity/reauthentication-attempts/${encodeURIComponent(command.attemptId)}/complete`,
    { method: "POST", headers: identitySessionHeaders(command) },
  );
}

export async function endIdentitySession(command: {
  readonly accessToken: string;
  readonly idempotencyKey: string;
  readonly sessionRef: string;
}): Promise<void> {
  const response = await requestIdentityBackend("/identity/sessions/current", {
    method: "DELETE",
    headers: {
      authorization: `Bearer ${command.accessToken}`,
      "idempotency-key": command.idempotencyKey,
      "x-platform-session": command.sessionRef,
    },
  });
  const payload = await readJson(response);
  if (!isRecord(payload) || payload.ended !== true) {
    throw invalidBackendResponse("Identity session end response does not match the contract");
  }
}

function identitySessionHeaders(command: {
  readonly accessToken: string;
  readonly idempotencyKey: string;
  readonly sessionRef: string;
}): Record<string, string> {
  return {
    authorization: `Bearer ${command.accessToken}`,
    "idempotency-key": command.idempotencyKey,
    "x-platform-session": command.sessionRef,
  };
}

async function requestIdentitySubject(
  path: `/${string}`,
  init: Pick<RequestInit, "headers" | "method">,
): Promise<IdentitySubject> {
  const response = await requestIdentityBackend(path, init);
  const payload = await readJson(response);
  if (!isRecord(payload) || !isIdentitySubject(payload.subject)) {
    throw invalidBackendResponse("Identity response does not match the contract");
  }
  return payload.subject;
}

async function requestIdentityBackend(
  path: `/${string}`,
  init: Pick<RequestInit, "headers" | "method">,
): Promise<Response> {
  const response = await requestBackend(path, init);
  if (!response.ok) {
    throw new BackendConnectionError(
      response.status >= 500 ? "unavailable" : "rejected",
      `Backend identity request returned ${String(response.status)}`,
    );
  }
  return response;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (cause) {
    throw invalidBackendResponse("Backend identity response is not valid JSON", cause);
  }
}

function invalidBackendResponse(message: string, cause?: unknown): BackendConnectionError {
  return new BackendConnectionError("invalid-response", message, { cause });
}

function isIdentitySubject(value: unknown): value is IdentitySubject {
  if (!isRecord(value)) {
    return false;
  }
  const permissions = value.permissions;
  return (
    isUuid(value.principalId) &&
    (value.principalKind === "human" || value.principalKind === "service") &&
    isUuid(value.sessionRef) &&
    isTimestamp(value.authenticatedAt) &&
    isTimestamp(value.expiresAt) &&
    Array.isArray(permissions) &&
    permissions.every(
      (permission) =>
        permission === "identity:admin" ||
        permission === "materials:author" ||
        permission === "materials:publish",
    )
  );
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

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return value;
}
