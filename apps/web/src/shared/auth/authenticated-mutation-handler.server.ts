import "server-only";

import type { z } from "zod";

import { privateAuthenticatedResponse } from "./private-response.server";

import {
  expirePublicCatalog,
  expirePublicCatalogAfter,
  isCatalogWrite,
} from "@/shared/api/catalog-cache.server";
import { MAX_BROWSER_MUTATION_BYTES } from "@/shared/api/mutation-limits";
import type { MutationOperation } from "@/shared/api/mutation-operation";
import {
  sessionAdapter,
  LogtoSessionUnavailableError,
} from "./session-adapter.server";
import { getOptionalPlatformAccessToken } from "./optional-platform-access-token.server";
import { readLogtoBffConfig } from "./logto-bff-config.server";
import { isSameOriginMutation } from "./same-origin-mutation.server";

type ExecuteMutation = (
  formData: FormData,
  accessToken: string,
) => Promise<unknown>;

type ExecuteStreamingMutation = (
  body: ReadableStream<Uint8Array> | null,
  accessToken: string,
) => Promise<Response>;

type ExecuteOptionalAuthenticatedMutation = (
  formData: FormData,
  accessToken: string | undefined,
) => Promise<Response>;

export type AuthenticatedMutationFailure =
  | "authentication_required"
  | "body_too_large"
  | "cross_origin_request"
  | "dependency_unavailable"
  | "identity_unavailable";

export interface StreamingMutationOptions {
  readonly failureResponse: (failure: AuthenticatedMutationFailure) => Response;
  readonly maxBytes: number;
  readonly mode: "stream";
}

/** Authenticates one same-origin browser mutation and returns its typed feature result. */
export function handleAuthenticatedMutation(
  request: Request,
  execute: ExecuteMutation,
): Promise<Response>;
export function handleAuthenticatedMutation(
  request: Request,
  execute: ExecuteStreamingMutation,
  options: StreamingMutationOptions,
): Promise<Response>;
export async function handleAuthenticatedMutation(
  request: Request,
  ...[execute, options]:
    | [execute: ExecuteMutation, options?: undefined]
    | [execute: ExecuteStreamingMutation, options: StreamingMutationOptions]
): Promise<Response> {
  if (!isSameOriginMutation(request, sessionAdapter.baseUrl())) {
    return options === undefined
      ? mutationResponse(null, 403)
      : privateAuthenticatedResponse(
          options.failureResponse("cross_origin_request"),
        );
  }
  const contentLength = Number(request.headers.get("content-length"));
  const maxBytes = options?.maxBytes ?? MAX_BROWSER_MUTATION_BYTES;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return options === undefined
      ? mutationResponse(null, 413)
      : privateAuthenticatedResponse(options.failureResponse("body_too_large"));
  }

  let accessToken: string;
  try {
    accessToken = await sessionAdapter.accessToken("route");
  } catch (error) {
    if (options !== undefined) {
      return privateAuthenticatedResponse(
        options.failureResponse(
          error instanceof LogtoSessionUnavailableError
            ? "authentication_required"
            : "identity_unavailable",
        ),
      );
    }
    return mutationResponse(
      null,
      error instanceof LogtoSessionUnavailableError ? 401 : 503,
    );
  }

  if (options !== undefined) {
    const limit = { exceeded: false };
    const body =
      request.body === null
        ? null
        : limitBodyStream(request.body, options.maxBytes, limit);
    try {
      return privateAuthenticatedResponse(await execute(body, accessToken));
    } catch {
      return privateAuthenticatedResponse(
        options.failureResponse(
          limit.exceeded ? "body_too_large" : "dependency_unavailable",
        ),
      );
    } finally {
      // Запись могла состояться и до сбоя ответа, поэтому кеш сбрасывается при любом исходе. В
      // `finally`, а не в `try`: сбой сброса не должен выдать состоявшуюся запись за недоступность.
      // Обе ветки возвращают ответ: отложенный сброс Next.js выполняет только при обычном возврате.
      expirePublicCatalogAfter(request);
    }
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return mutationResponse(null, 400);
  }
  if (formDataByteLength(formData) > maxBytes) {
    return mutationResponse(null, 413);
  }

  return executeMutation(request, () => execute(formData, accessToken));
}

export interface MutationOperationImplementation<
  Input extends z.ZodType,
  Result extends z.ZodType,
> {
  /** Calls Nest with the parsed input and maps its answer to the operation result. */
  readonly execute: (
    input: z.output<Input>,
    accessToken: string,
  ) => Promise<z.input<Result>>;
  /** The feature outcome for a body that does not match the operation's input schema. */
  readonly invalidInput: (error: z.ZodError) => z.input<Result>;
}

/**
 * Serves one operation declared by `defineMutationOperation` (ADR 0038): the shared Origin,
 * body-size and session boundary, then the operation's JSON input schema and its backend call.
 */
export async function handleMutationOperation<
  Input extends z.ZodType,
  Result extends z.ZodType,
>(
  request: Request,
  operation: MutationOperation<Input, Result>,
  implementation: MutationOperationImplementation<Input, Result>,
): Promise<Response> {
  if (!isSameOriginMutation(request, sessionAdapter.baseUrl())) {
    return mutationResponse(null, 403);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BROWSER_MUTATION_BYTES
  ) {
    return mutationResponse(null, 413);
  }

  let accessToken: string;
  try {
    accessToken = await sessionAdapter.accessToken("route");
  } catch (error) {
    return mutationResponse(
      null,
      error instanceof LogtoSessionUnavailableError ? 401 : 503,
    );
  }

  const body = await readJsonBody(request);
  if (!body.ok) return mutationResponse(null, body.status);
  const input = operation.input.safeParse(body.value);
  if (!input.success) {
    return mutationResponse(implementation.invalidInput(input.error), 200);
  }
  return executeMutation(request, () =>
    implementation.execute(input.data, accessToken),
  );
}

async function executeMutation(
  request: Request,
  execute: () => Promise<unknown>,
): Promise<Response> {
  let result: unknown;
  try {
    result = await execute();
  } catch (error) {
    // Запись могла состояться до того, как потерялся ответ backend. Отложенный сброс кеша Next.js
    // выполняет только при обычном возврате обработчика, а с исключением отбрасывает, поэтому сбой
    // записи каталога отвечает недоступностью. Остальные записи падают, как и раньше.
    if (!isCatalogWrite(request)) throw error;
    // Исключение больше не доходит до Next.js, который печатал его сам.
    console.error(error);
    expirePublicCatalog();
    return mutationResponse(null, 503);
  }
  expirePublicCatalogAfter(request);
  return mutationResponse(result, 200);
}

/** Reads a JSON body under the shared limit: 400 for another encoding or malformed JSON. */
async function readJsonBody(
  request: Request,
): Promise<
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly status: 400 | 413 }
> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return { ok: false, status: 400 };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400 };
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BROWSER_MUTATION_BYTES) {
    return { ok: false, status: 413 };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** Applies the shared browser-mutation boundary while allowing an anonymous caller. */
export async function handleOptionalAuthenticatedMutation(
  request: Request,
  execute: ExecuteOptionalAuthenticatedMutation,
): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return mutationResponse(null, 403);
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_BROWSER_MUTATION_BYTES
  ) {
    return mutationResponse(null, 413);
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return mutationResponse(null, 400);
  }
  if (formDataByteLength(formData) > MAX_BROWSER_MUTATION_BYTES) {
    return mutationResponse(null, 413);
  }
  try {
    return privateAuthenticatedResponse(
      await execute(formData, await getOptionalPlatformAccessToken(request)),
    );
  } catch {
    return mutationResponse(null, 503);
  }
}

function limitBodyStream(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
  state: { exceeded: boolean },
): ReadableStream<Uint8Array> {
  let bytes = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          state.exceeded = true;
          controller.error(
            new Error("Mutation body exceeded its capability limit"),
          );
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

function formDataByteLength(formData: FormData): number {
  const encoder = new TextEncoder();
  let bytes = 0;
  for (const [name, value] of formData.entries()) {
    bytes += encoder.encode(name).byteLength;
    bytes +=
      typeof value === "string" ? encoder.encode(value).byteLength : value.size;
    if (bytes > MAX_BROWSER_MUTATION_BYTES) return bytes;
  }
  return bytes;
}

function mutationResponse(body: unknown, status: number): Response {
  return privateAuthenticatedResponse(
    body === null
      ? new Response(null, { status })
      : Response.json(body, { status }),
  );
}
