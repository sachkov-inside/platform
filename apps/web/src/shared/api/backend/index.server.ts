import "server-only";

import { z } from "zod";

import { readWebRuntimeConfig } from "@/shared/config/index.server";

import {
  AccountsService,
  ApiError,
  BaseHttpRequest,
  CancelablePromise,
  ContentLibraryService,
  MemberProfilesService,
  MaterialAuthoringService,
  OperationsService,
  PublishedMaterialsService,
  type OpenAPIConfig,
} from "./generated/platform-api";
import type { ApiRequestOptions } from "./generated/platform-api/core/ApiRequestOptions";
import type { ApiResult } from "./generated/platform-api/core/ApiResult";

const BACKEND_REQUEST_TIMEOUT_MS = 3_000;
const BACKEND_UPLOAD_TIMEOUT_MS = 60_000;

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
  try {
    return readWebRuntimeConfig().backendBaseUrl;
  } catch (cause) {
    throw new BackendConnectionError(
      "configuration",
      cause instanceof Error ? cause.message : "Web runtime configuration is invalid",
      { cause },
    );
  }
}

export function requestPublishedMaterialCatalog(
  query: {
    readonly after?: string;
    readonly format?: readonly string[];
    readonly q?: string;
    readonly series?: readonly string[];
    readonly sort?: "newest" | "relevance" | "series" | "title";
    readonly topic?: readonly string[];
  },
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ContentLibraryService(request).listPublishedMaterials(
        {
          ...(query.after === undefined ? {} : { after: query.after }),
          ...(query.format === undefined ? {} : { format: [...query.format] }),
          ...(query.q === undefined ? {} : { q: query.q }),
          ...(query.series === undefined ? {} : { series: [...query.series] }),
          ...(query.sort === undefined ? {} : { sort: query.sort }),
          ...(query.topic === undefined ? {} : { topic: [...query.topic] }),
        },
      ),
    200,
    options,
  );
}

export function requestPublishedTopic(
  slug: string,
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new ContentLibraryService(request).readPublishedTopic({ slug }),
    200,
    options,
  );
}

export function requestPublishedSeries(
  slug: string,
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new ContentLibraryService(request).readPublishedSeries({ slug }),
    200,
    options,
  );
}

export function requestRelatedPublishedMaterials(
  slug: string,
  options: {
    readonly accessToken?: string;
    readonly signal?: AbortSignal;
  } = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ContentLibraryService(request).readRelatedPublishedMaterials({ slug }),
    200,
    options,
  );
}

export function requestAuthoringMaterials(
  query: {
    readonly page: number;
    readonly publicationState?: "draft" | "published" | "unpublished";
    readonly search?: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).listAuthoringMaterials(query),
    200,
    { accessToken },
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

export function requestPrivateMemberProfile(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MemberProfilesService(request).readPrivateAccountProfile(),
    200,
    { accessToken },
  );
}

export function requestMemberProfileCreation(
  input: { readonly bio: string | null; readonly displayName: string },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MemberProfilesService(request).createMemberProfile({
        requestBody: input,
      }),
    201,
    { accessToken },
  );
}

export function requestMemberProfileUpdate(
  input: {
    readonly bio: string | null;
    readonly displayName: string;
    readonly expectedVersion: number;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MemberProfilesService(request).updateMemberProfile({
        requestBody: input,
      }),
    200,
    { accessToken },
  );
}

export function requestMemberProfileProjection(
  publicProfileId: string,
  accessToken?: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MemberProfilesService(request).viewMemberProfile({ publicProfileId }),
    200,
    accessToken === undefined ? {} : { accessToken },
  );
}

export function requestMaterialDraftCreation(
  input: {
    readonly access: "free" | "membership";
    readonly document: Record<string, unknown>;
    readonly formatId: string | null;
    readonly idempotencyKey: string;
    readonly seriesIds: readonly string[];
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
            seriesIds: [...input.seriesIds],
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

export function requestCurrentMaterial(
  materialId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).loadCurrentMaterial({ materialId }),
    200,
    { accessToken },
  );
}

export function requestMaterialSave(
  input: {
    readonly access: "free" | "membership";
    readonly document: Record<string, unknown>;
    readonly expectedContentVersion: number;
    readonly formatId: string | null;
    readonly idempotencyKey: string;
    readonly materialId: string;
    readonly publicationState: "draft" | "published" | "unpublished";
    readonly seriesIds: readonly string[];
    readonly summary: string | null;
    readonly tagIds: readonly string[];
    readonly title: string | null;
    readonly topicId: string | null;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).saveCurrentMaterial({
        idempotencyKey: input.idempotencyKey,
        materialId: input.materialId,
        requestBody: {
          body: { doc: input.document, schemaVersion: 1 },
          expectedContentVersion: input.expectedContentVersion,
          metadata: {
            access: input.access,
            formatId: input.formatId,
            seriesIds: [...input.seriesIds],
            summary: input.summary,
            tagIds: [...input.tagIds],
            title: input.title,
            topicId: input.topicId,
          },
          publicationState: input.publicationState,
        },
      }),
    200,
    { accessToken },
  );
}

export function requestMaterialDeletion(
  input: {
    readonly expectedContentVersion: number;
    readonly idempotencyKey: string;
    readonly materialId: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).deleteMaterialDraft({
        idempotencyKey: input.idempotencyKey,
        materialId: input.materialId,
        requestBody: {
          expectedContentVersion: input.expectedContentVersion,
        },
      }),
    200,
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

export function requestSeriesOrder(
  seriesId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).loadAuthoringSeriesOrder({ seriesId }),
    200,
    { accessToken },
  );
}

export function requestSeriesReorder(
  input: {
    readonly expectedOrderVersion: string;
    readonly orderedMaterialIds: readonly string[];
    readonly seriesId: string;
  },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new MaterialAuthoringService(request).reorderAuthoringSeries({
        seriesId: input.seriesId,
        requestBody: {
          expectedOrderVersion: input.expectedOrderVersion,
          orderedMaterialIds: [...input.orderedMaterialIds],
        },
      }),
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

export function requestMaterialAssetUpload(input: {
  readonly accessToken: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
  readonly idempotencyKey: string;
  readonly materialId: string;
  readonly signal: AbortSignal;
}): Promise<Response> {
  const init: RequestInit & { duplex: "half" } = {
    body: input.body,
    cache: "no-store",
    duplex: "half",
    headers: {
      authorization: `Bearer ${input.accessToken}`,
      "content-type": input.contentType,
      "idempotency-key": input.idempotencyKey,
    },
    method: "POST",
    signal: AbortSignal.any([
      input.signal,
      AbortSignal.timeout(BACKEND_UPLOAD_TIMEOUT_MS),
    ]),
  };
  return fetch(
    `${readBackendBaseUrl()}/authoring/materials/${encodeURIComponent(input.materialId)}/assets`,
    init,
  );
}

export function requestMaterialAssetDelivery(input: {
  readonly accessToken?: string;
  readonly assetId: string;
  readonly contentVersion: number;
  readonly materialId: string;
  readonly preview: boolean;
  readonly signal: AbortSignal;
  readonly variantWidth?: string;
}): Promise<Response> {
  const path = input.variantWidth === undefined
    ? `/materials/${encodeURIComponent(input.materialId)}/assets/${encodeURIComponent(input.assetId)}`
    : `/materials/${encodeURIComponent(input.materialId)}/assets/${encodeURIComponent(input.assetId)}/images/${encodeURIComponent(input.variantWidth)}`;
  const url = new URL(`${readBackendBaseUrl()}${path}`);
  url.searchParams.set("contentVersion", String(input.contentVersion));
  if (input.preview) url.searchParams.set("preview", "true");
  return fetch(url, {
    cache: "no-store",
    headers: input.accessToken === undefined
      ? {}
      : { authorization: `Bearer ${input.accessToken}` },
    redirect: "manual",
    signal: AbortSignal.any([input.signal, AbortSignal.timeout(10_000)]),
  });
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
