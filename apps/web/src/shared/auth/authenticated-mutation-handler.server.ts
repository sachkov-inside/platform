import "server-only";

import {
  expirePublicCatalog,
  expirePublicCatalogAfter,
  isCatalogWrite,
} from "@/shared/api/catalog-cache.server";
import { MAX_BROWSER_MUTATION_BYTES } from "@/shared/api/mutation-limits";
import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "./platform-access-token.server";
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
  execute: ExecuteMutation | ExecuteStreamingMutation,
  options?: StreamingMutationOptions,
): Promise<Response> {
  const config = readLogtoBffConfig();
  if (!isSameOriginMutation(request, config.baseUrl)) {
    return options === undefined
      ? mutationResponse(null, 403)
      : privateMutationResponse(
          options.failureResponse("cross_origin_request"),
        );
  }
  const contentLength = Number(request.headers.get("content-length"));
  const maxBytes = options?.maxBytes ?? MAX_BROWSER_MUTATION_BYTES;
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    return options === undefined
      ? mutationResponse(null, 413)
      : privateMutationResponse(options.failureResponse("body_too_large"));
  }

  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(config);
  } catch (error) {
    if (options !== undefined) {
      return privateMutationResponse(
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
      return privateMutationResponse(
        await (execute as ExecuteStreamingMutation)(body, accessToken),
      );
    } catch {
      return privateMutationResponse(
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

  let result: unknown;
  try {
    result = await (execute as ExecuteMutation)(formData, accessToken);
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
    return privateMutationResponse(
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
  const headers = {
    "cache-control": "no-store, private",
    vary: "cookie",
  };
  return body === null
    ? new Response(null, { headers, status })
    : Response.json(body, { headers, status });
}

function privateMutationResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store, private");
  const vary = headers.get("vary");
  if (vary === null) headers.set("vary", "cookie");
  else if (
    !vary
      .toLowerCase()
      .split(",")
      .some((value) => value.trim() === "cookie")
  ) {
    headers.set("vary", `${vary}, cookie`);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
