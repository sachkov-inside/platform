import "server-only";

import createClient from "openapi-fetch";
import { z } from "zod";

import type { paths } from "./generated/platform-api";

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

export type BackendTransportResult =
  | {
      readonly ok: true;
      readonly body: unknown;
      readonly response: Response;
    }
  | {
      readonly ok: false;
      readonly problem: unknown;
      readonly response: Response;
    };

const authenticatedAccountSchema = z.object({ accountId: z.uuid() }).strict();
const accountResponseSchema = z
  .object({ account: authenticatedAccountSchema })
  .strict();
const backendHealthSchema = z
  .object({
    process: z.literal("api"),
    status: z.literal("ok"),
    database: z.literal("reachable"),
  })
  .strict();
const backendHealthUnavailableProblemSchema = z
  .object({
    type: z.literal("about:blank"),
    title: z.literal("Service unavailable"),
    status: z.literal(503),
    code: z.literal("dependency_unavailable"),
  })
  .strict();
const accountProblemDetailsSchema = z.discriminatedUnion("code", [
  accountProblemSchema("invalid_input", 400, "Invalid account request"),
  accountProblemSchema("invalid_proof", 401, "Account verification failed"),
  accountProblemSchema("account_not_found", 401, "Account verification failed"),
  accountProblemSchema("identity_conflict", 409, "Account identity conflict"),
  accountProblemSchema("internal_error", 500, "Account service error"),
  accountProblemSchema(
    "dependency_unavailable",
    503,
    "Identity provider unavailable",
  ),
]);

export type BackendHealth = Readonly<z.infer<typeof backendHealthSchema>>;
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

export function requestPublishedMaterialCatalog(
  after: string | undefined,
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest((client) =>
    client.GET("/library/materials", {
      ...(options.accessToken === undefined
        ? {}
        : { headers: { authorization: `Bearer ${options.accessToken}` } }),
      params: {
        query: after === undefined ? {} : { after },
      },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
  );
}

export function requestPublishedMaterial(
  slug: string,
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest((client) =>
    client.GET("/materials/{slug}", {
      ...(options.accessToken === undefined
        ? {}
        : { headers: { authorization: `Bearer ${options.accessToken}` } }),
      params: { path: { slug } },
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    }),
  );
}

function requestBackendHealth(): Promise<BackendTransportResult> {
  return executeGeneratedRequest((client) => client.GET("/health"));
}

function requestAccountEstablishment(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest((client) =>
    client.POST("/accounts", {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  );
}

function requestCurrentAccount(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest((client) =>
    client.GET("/accounts/current", {
      headers: { authorization: `Bearer ${accessToken}` },
    }),
  );
}

interface GeneratedResponse {
  readonly data?: unknown;
  readonly error?: unknown;
  readonly response: Response;
}

async function executeGeneratedRequest(
  invoke: (
    client: ReturnType<typeof createBackendClient>,
  ) => Promise<GeneratedResponse>,
): Promise<BackendTransportResult> {
  const result = await invoke(createBackendClient());
  return result.response.ok
    ? { ok: true, body: result.data, response: result.response }
    : { ok: false, problem: result.error, response: result.response };
}

function createBackendClient() {
  return createClient<paths>({
    baseUrl: readBackendBaseUrl(),
    fetch: fetchBackend,
  });
}

async function fetchBackend(request: Request): Promise<Response> {
  try {
    return await fetch(
      new Request(request, {
        cache: "no-store",
        signal: combineAbortSignals(request.signal),
      }),
    );
  } catch (cause) {
    throw new BackendConnectionError("unavailable", "Backend request failed", {
      cause,
    });
  }
}

function combineAbortSignals(signal: AbortSignal | null | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(BACKEND_REQUEST_TIMEOUT_MS);
  return signal === undefined || signal === null
    ? timeout
    : AbortSignal.any([signal, timeout]);
}

export async function getBackendHealth(): Promise<BackendHealth> {
  const result = await requestBackendHealth();

  if (!result.ok) {
    const parsed = backendHealthUnavailableProblemSchema.safeParse(
      result.problem,
    );
    throw new BackendConnectionError(
      parsed.success && parsed.data.status === result.response.status
        ? "unavailable"
        : "backend-error",
      `Backend health request returned ${String(result.response.status)}`,
      { cause: parsed.success ? undefined : parsed.error },
    );
  }
  const parsed = backendHealthSchema.safeParse(result.body);
  if (!parsed.success) {
    throw new BackendConnectionError(
      "invalid-response",
      "Backend health response does not match the contract",
      { cause: parsed.error },
    );
  }

  return parsed.data;
}

export async function establishAccount(
  accessToken: string,
): Promise<AuthenticatedAccount> {
  return parseAccountResponse(await requestAccountEstablishment(accessToken));
}

export async function resolveAccount(
  accessToken: string,
): Promise<AuthenticatedAccount> {
  return parseAccountResponse(await requestCurrentAccount(accessToken));
}

function parseAccountResponse(
  result: BackendTransportResult,
): AuthenticatedAccount {
  if (!result.ok) {
    const parsed = accountProblemDetailsSchema.safeParse(result.problem);
    if (!parsed.success || parsed.data.status !== result.response.status) {
      throw new BackendConnectionError(
        "backend-error",
        `Backend Account request returned an unknown ${String(result.response.status)} error`,
        { cause: parsed.success ? undefined : parsed.error },
      );
    }
    throw new BackendConnectionError(
      parsed.data.code === "dependency_unavailable" ||
        parsed.data.code === "internal_error"
        ? "unavailable"
        : "rejected",
      `Backend Account request returned ${String(result.response.status)}`,
    );
  }
  const parsed = accountResponseSchema.safeParse(result.body);
  if (!parsed.success) {
    throw invalidBackendResponse("Account response does not match the contract");
  }
  return parsed.data.account;
}

function invalidBackendResponse(message: string): BackendConnectionError {
  return new BackendConnectionError("invalid-response", message);
}

function accountProblemSchema<
  const Code extends string,
  const Status extends number,
  const Title extends string,
>(code: Code, status: Status, title: Title) {
  return z
    .object({
      type: z.literal(
        `https://inside.sachkov.com/problems/accounts/${code.replaceAll("_", "-")}`,
      ),
      title: z.literal(title),
      status: z.literal(status),
      detail: z.literal("Account request could not be completed."),
      code: z.literal(code),
      correlationId: z.string().optional(),
    })
    .strict();
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  return value;
}
