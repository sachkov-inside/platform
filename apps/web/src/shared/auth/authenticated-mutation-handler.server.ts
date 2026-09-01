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

/** Authenticates one same-origin browser mutation and returns its typed feature result. */
export async function handleAuthenticatedMutation(
  request: Request,
  execute: ExecuteMutation,
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

  let accessToken: string;
  try {
    accessToken = await getPlatformAccessToken(config);
  } catch (error) {
    return mutationResponse(
      null,
      error instanceof LogtoSessionUnavailableError ? 401 : 503,
    );
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

  return mutationResponse(await execute(formData, accessToken), 200);
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
