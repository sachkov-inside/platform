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

type ExecuteStreamingMutation = (
  body: ReadableStream<Uint8Array> | null,
  accessToken: string,
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

/**
 * Authenticates one same-origin request whose body is streamed under a named limit: a binary
 * upload or the cover removal paired with it (ADR 0038). Other browser mutations are operations
 * served by `handleMutationOperation` or `handleOptionalMutationOperation`.
 */
export async function handleAuthenticatedMutation(
  request: Request,
  execute: ExecuteStreamingMutation,
  options: StreamingMutationOptions,
): Promise<Response> {
  if (!isSameOriginMutation(request, sessionAdapter.baseUrl())) {
    return privateAuthenticatedResponse(
      options.failureResponse("cross_origin_request"),
    );
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
    return privateAuthenticatedResponse(
      options.failureResponse("body_too_large"),
    );
  }

  let accessToken: string;
  try {
    accessToken = await sessionAdapter.accessToken("route");
  } catch (error) {
    return privateAuthenticatedResponse(
      options.failureResponse(
        error instanceof LogtoSessionUnavailableError
          ? "authentication_required"
          : "identity_unavailable",
      ),
    );
  }

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
  implementation: NoInfer<MutationOperationImplementation<Input, Result>>,
): Promise<Response> {
  const refused = refuseForeignOrOversized(request, sessionAdapter.baseUrl());
  if (refused !== undefined) return refused;

  let accessToken: string;
  try {
    accessToken = await sessionAdapter.accessToken("route");
  } catch (error) {
    return mutationResponse(
      null,
      error instanceof LogtoSessionUnavailableError ? 401 : 503,
    );
  }

  const input = await readOperationInput(request, operation.input);
  if (!input.ok) return input.response;
  if (!input.parsed.success) {
    return mutationResponse(
      implementation.invalidInput(input.parsed.error),
      200,
    );
  }
  const data = input.parsed.data;
  return executeMutation(request, () =>
    implementation.execute(data, accessToken),
  );
}

export interface OptionalMutationOperationImplementation<
  Input extends z.ZodType,
> {
  /** Answers with its own status; a missing session reaches it as `undefined`. */
  readonly execute: (
    input: z.output<Input>,
    accessToken: string | undefined,
  ) => Promise<Response>;
  /** The answer for a body outside the operation's input schema. */
  readonly invalidInput: (error: z.ZodError) => Response;
}

/**
 * Serves an operation a guest may also send (ADR 0038): the shared Origin and body-size boundary,
 * the operation's JSON input schema and an optional session. The feature owns every answer and
 * its status, so the route's `result` schema is held by its tests rather than by the compiler.
 */
export async function handleOptionalMutationOperation<
  Input extends z.ZodType,
  Result extends z.ZodType,
>(
  request: Request,
  operation: MutationOperation<Input, Result>,
  implementation: NoInfer<OptionalMutationOperationImplementation<Input>>,
): Promise<Response> {
  const refused = refuseForeignOrOversized(
    request,
    readLogtoBffConfig().baseUrl,
  );
  if (refused !== undefined) return refused;
  const input = await readOperationInput(request, operation.input);
  if (!input.ok) return input.response;
  if (!input.parsed.success) {
    return privateAuthenticatedResponse(
      implementation.invalidInput(input.parsed.error),
    );
  }
  const data = input.parsed.data;
  try {
    return privateAuthenticatedResponse(
      await implementation.execute(
        data,
        await getOptionalPlatformAccessToken(request),
      ),
    );
  } catch {
    return mutationResponse(null, 503);
  }
}

/** The shared first checks: another Origin answers 403, a declared body above the limit 413. */
function refuseForeignOrOversized(
  request: Request,
  baseUrl: string,
): Response | undefined {
  if (!isSameOriginMutation(request, baseUrl)) {
    return mutationResponse(null, 403);
  }
  const contentLength = Number(request.headers.get("content-length"));
  return Number.isFinite(contentLength) &&
    contentLength > MAX_BROWSER_MUTATION_BYTES
    ? mutationResponse(null, 413)
    : undefined;
}

/** Reads the JSON body and parses it with the operation's input schema. */
async function readOperationInput<Input extends z.ZodType>(
  request: Request,
  schema: Input,
): Promise<
  | {
      readonly ok: true;
      readonly parsed: z.ZodSafeParseResult<z.output<Input>>;
    }
  | { readonly ok: false; readonly response: Response }
> {
  const body = await readJsonBody(request);
  if (!body.ok)
    return { ok: false, response: mutationResponse(null, body.status) };
  try {
    return { ok: true, parsed: schema.safeParse(body.value) };
  } catch (error) {
    // Глубоко вложенное тело исчерпывает стек схемы; это неверный запрос, а не сбой сервера.
    // Другая ошибка схемы остаётся ошибкой программы.
    if (!(error instanceof RangeError)) throw error;
    return { ok: false, response: mutationResponse(null, 400) };
  }
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
  // Тело без заявленной длины читается потоком и обрывается на лимите, а не целиком в память.
  const limit = { exceeded: false };
  let text: string;
  try {
    text =
      request.body === null
        ? ""
        : await new Response(
            limitBodyStream(request.body, MAX_BROWSER_MUTATION_BYTES, limit),
          ).text();
  } catch {
    return { ok: false, status: limit.exceeded ? 413 : 400 };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400 };
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

function mutationResponse(body: unknown, status: number): Response {
  return privateAuthenticatedResponse(
    body === null
      ? new Response(null, { status })
      : Response.json(body, { status }),
  );
}
