import "server-only";

import { MAX_BROWSER_MUTATION_BYTES } from "@/shared/api/mutation-limits";
import {
  getPlatformAccessToken,
  LogtoSessionUnavailableError,
} from "./platform-access-token.server";
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

export type AuthenticatedMutationFailure =
  | "authentication_required"
  | "body_too_large"
  | "cross_origin_request"
  | "dependency_unavailable"
  | "identity_unavailable";

export interface StreamingMutationOptions {
  readonly failureResponse: (
    failure: AuthenticatedMutationFailure,
  ) => Response;
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
      const response = await (execute as ExecuteStreamingMutation)(
        body,
        accessToken,
      );
      return privateMutationResponse(response);
    } catch {
      return privateMutationResponse(
        options.failureResponse(
          limit.exceeded ? "body_too_large" : "dependency_unavailable",
        ),
      );
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

  return mutationResponse(
    await (execute as ExecuteMutation)(formData, accessToken),
    200,
  );
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
      typeof value === "string"
        ? encoder.encode(value).byteLength
        : value.size;
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
