import "server-only";

import { z } from "zod";

import {
  AccountsService,
  ApiError,
  BaseHttpRequest,
  CancelablePromise,
  ContentLibraryService,
  MaterialAuthoringService,
  OperationsService,
  PublishedMaterialsService,
  type OpenAPIConfig,
} from "./generated/platform-api";
import type { ApiRequestOptions } from "./generated/platform-api/core/ApiRequestOptions";
import type { ApiResult } from "./generated/platform-api/core/ApiResult";

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
  return executeGeneratedRequest(
    (request) =>
      new ContentLibraryService(request).listPublishedMaterials(
        after === undefined ? {} : { after },
      ),
    200,
    options,
  );
}

export function requestPublishedMaterial(
  slug: string,
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new PublishedMaterialsService(request).readPublishedMaterial({ slug }),
    200,
    options,
  );
}

export function requestMaterialDraftCreation(
  input: {
    readonly access: "free" | "membership";
    readonly document: Record<string, unknown>;
    readonly formatId: string | null;
    readonly idempotencyKey: string;
    readonly summary: string;
    readonly tagIds: readonly string[];
    readonly title: string;
    readonly topicId: string | null;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).createMaterialDraft({
        idempotencyKey: input.idempotencyKey,
        requestBody: {
          body: { doc: input.document, schemaVersion: 1 },
          metadata: {
            access: input.access,
            formatId: input.formatId,
            seriesMemberships: [],
            slug: null,
            summary: input.summary,
            tagIds: [...input.tagIds],
            title: input.title,
            topicId: input.topicId,
          },
        },
      }),
    201,
    { accessToken },
  );
}

export function requestMaterialAuthoringReferences(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).listMaterialAuthoringReferences(),
    200,
    { accessToken },
  );
}

export function requestMaterialValidation(
  materialId: string,
  contentVersion: number,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).validateCurrentMaterial({
        expectedContentVersion: contentVersion,
        materialId,
      }),
    200,
    { accessToken },
  );
}

export function requestMaterialPreview(
  materialId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).previewCurrentMaterial({ materialId }),
    200,
    { accessToken },
  );
}

function requestBackendHealth(): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new OperationsService(request).getApiHealth(),
    200,
  );
}

function requestAccountEstablishment(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new AccountsService(request).establishAccount(),
    201,
    { accessToken },
  );
}

function requestCurrentAccount(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new AccountsService(request).resolveCurrentAccount(),
    200,
    { accessToken },
  );
}

async function executeGeneratedRequest<T>(
  invoke: (request: BackendHttpRequest) => CancelablePromise<T>,
  successStatus: number,
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  const request = new BackendHttpRequest(
    createBackendConfig(options.accessToken),
    options.signal,
  );
  const operation = invoke(request);
  try {
    const body = await operation;
    const response = request.response;
    if (response === undefined || response.status !== successStatus) {
      throw new BackendConnectionError(
        "invalid-response",
        `Generated backend operation expected HTTP ${String(successStatus)}`,
      );
    }
    return { ok: true, body, response };
  } catch (cause) {
    if (cause instanceof ApiError && request.response !== undefined) {
      return {
        ok: false,
        problem: cause.body,
        response: request.response,
      };
    }
    if (cause instanceof BackendConnectionError) {
      throw cause;
    }
    throw new BackendConnectionError("unavailable", "Backend request failed", {
      cause,
    });
  }
}

function createBackendConfig(accessToken: string | undefined): OpenAPIConfig {
  return {
    BASE: readBackendBaseUrl(),
    VERSION: "1.0.0",
    WITH_CREDENTIALS: false,
    CREDENTIALS: "omit",
    TOKEN: accessToken,
  };
}

class BackendHttpRequest extends BaseHttpRequest {
  response: Response | undefined;
  readonly #externalSignal: AbortSignal | undefined;

  constructor(config: OpenAPIConfig, externalSignal: AbortSignal | undefined) {
    super(config);
    this.#externalSignal = externalSignal;
  }

  override request<T>(options: ApiRequestOptions): CancelablePromise<T> {
    return new CancelablePromise<T>((resolve, reject, onCancel) => {
      const cancellation = new AbortController();
      onCancel(() => {
        cancellation.abort();
      });

      void this.#execute<T>(options, cancellation.signal).then(resolve, reject);
    });
  }

  async #execute<T>(
    options: ApiRequestOptions,
    cancellationSignal: AbortSignal,
  ): Promise<T> {
    const response = await fetch(
      new Request(buildBackendUrl(this.config.BASE, options), {
        body: serializeRequestBody(options),
        cache: "no-store",
        headers: buildBackendHeaders(this.config, options),
        method: options.method,
        signal: AbortSignal.any([
          cancellationSignal,
          AbortSignal.timeout(BACKEND_REQUEST_TIMEOUT_MS),
          ...(this.#externalSignal === undefined
            ? []
            : [this.#externalSignal]),
        ]),
      }),
    );
    this.response = response;
    const body = await parseResponseBody(response);
    if (!response.ok) {
      const result: ApiResult = {
        body,
        ok: false,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
      };
      throw new ApiError(
        options,
        result,
        options.errors?.[response.status] ?? response.statusText,
      );
    }
    return body as T;
  }
}

function buildBackendUrl(baseUrl: string, options: ApiRequestOptions): string {
  const pathValues = (options.path ?? {}) as Readonly<Record<string, unknown>>;
  let path = options.url;
  for (const [key, value] of Object.entries(pathValues)) {
    path = path.replace(`{${key}}`, encodeURIComponent(transportString(value)));
  }
  const url = new URL(`${baseUrl}${path}`);
  const query = (options.query ?? {}) as Readonly<Record<string, unknown>>;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, transportString(item));
    }
  }
  return url.toString();
}

function buildBackendHeaders(
  config: OpenAPIConfig,
  options: ApiRequestOptions,
): Headers {
  const headers = new Headers({ Accept: "application/json" });
  const optionHeaders = (options.headers ?? {}) as Readonly<
    Record<string, unknown>
  >;
  for (const [key, value] of Object.entries(optionHeaders)) {
    if (value !== undefined && value !== null) {
      headers.set(key, transportString(value));
    }
  }
  if (typeof config.TOKEN === "string" && config.TOKEN.length > 0) {
    headers.set("Authorization", `Bearer ${config.TOKEN}`);
  }
  if (options.body !== undefined) {
    headers.set("Content-Type", options.mediaType ?? "application/json");
  }
  return headers;
}

function serializeRequestBody(options: ApiRequestOptions): BodyInit | null {
  const body = options.body as unknown;
  if (body === undefined || body === null) return null;
  if (
    typeof body === "string" ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer
  ) {
    return body;
  }
  return JSON.stringify(body);
}

async function parseResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (
    contentType.startsWith("application/json") ||
    contentType.startsWith("application/problem+json")
  ) {
    return JSON.parse(text) as unknown;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function transportString(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value.toString();
  }
  throw new TypeError("Generated request parameter must be scalar");
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
