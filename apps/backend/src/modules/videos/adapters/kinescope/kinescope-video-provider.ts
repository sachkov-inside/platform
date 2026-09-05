import { z } from "zod";

import type {
  ProviderVideo,
  VideoProvider,
} from "../../ports/video-provider.js";

const initResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1).max(256),
    endpoint: z.url().max(2_048),
  }).loose(),
}).loose();

const providerResponseSchema = z.object({ data: z.record(z.string(), z.unknown()) }).loose();
const deleteResponseSchema = z.object({
  data: z.object({ success: z.literal(true) }).strict(),
}).loose();
const KINESCOPE_REQUEST_TIMEOUT_MILLISECONDS = 8_000;

export function createKinescopeVideoProvider(config: {
  readonly apiBaseUrl: string;
  readonly apiToken: string;
  readonly uploaderBaseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
}): VideoProvider {
  const request = config.fetch ?? globalThis.fetch;
  const provider: VideoProvider = {
    async delete(input) {
      let response: Response;
      try {
        response = await request(
          new URL(`/v1/videos/${encodeURIComponent(input.id)}`, config.apiBaseUrl),
          {
            headers: { authorization: `Bearer ${config.apiToken}` },
            method: "DELETE",
            signal: AbortSignal.timeout(KINESCOPE_REQUEST_TIMEOUT_MILLISECONDS),
          },
        );
      } catch (error) {
        return {
          category: isTimeout(error) ? "timeout" : "network",
          kind: "retryable_failure",
        };
      }
      const providerRequestId = readProviderRequestId(response);
      if (response.status === 404) {
        return { kind: "not_found", ...providerRequestId };
      }
      if (response.status === 429) {
        return {
          category: "rate_limited",
          kind: "retryable_failure",
          ...providerRequestId,
        };
      }
      if (response.status >= 500) {
        return {
          category: "provider_unavailable",
          kind: "retryable_failure",
          ...providerRequestId,
        };
      }
      const terminalCategory = response.status === 400
        ? "invalid_request"
        : response.status === 401
          ? "authentication"
          : response.status === 403
            ? "permission"
            : null;
      if (terminalCategory !== null) {
        return {
          category: terminalCategory,
          kind: "terminal_failure",
          ...providerRequestId,
        };
      }
      if (!response.ok) {
        return {
          category: "invalid_response",
          kind: "terminal_failure",
          ...providerRequestId,
        };
      }
      try {
        deleteResponseSchema.parse(await response.json());
        return { kind: "deleted", ...providerRequestId };
      } catch {
        return {
          category: "invalid_response",
          kind: "terminal_failure",
          ...providerRequestId,
        };
      }
    },
    async initUpload(input) {
      const response = await request(new URL("/v2/init", config.uploaderBaseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          parent_id: input.projectId,
          type: "video",
          filename: input.filename,
          title: input.title,
          filesize: input.byteSize,
        }),
        signal: AbortSignal.timeout(KINESCOPE_REQUEST_TIMEOUT_MILLISECONDS),
      });
      if (!response.ok) throw new Error("Kinescope upload init failed");
      const parsed = initResponseSchema.parse(await response.json());
      assertKinescopeUrl(parsed.data.endpoint, "upload endpoint");
      return { id: parsed.data.id, uploadEndpoint: parsed.data.endpoint };
    },
    async find(input) {
      const response = await request(
        new URL(`/v1/videos/${encodeURIComponent(input.id)}`, config.apiBaseUrl),
        {
          headers: { authorization: `Bearer ${config.apiToken}` },
          signal: AbortSignal.timeout(KINESCOPE_REQUEST_TIMEOUT_MILLISECONDS),
        },
      );
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("Kinescope video lookup failed");
      const parsed = providerResponseSchema.parse(await response.json());
      return parseProviderVideo(parsed.data);
    },
  };
  return Object.freeze(provider);
}

function readProviderRequestId(
  response: Response,
): { readonly providerRequestId?: string } {
  const value = response.headers.get("x-request-id")?.trim();
  return value === undefined || value.length === 0 || value.length > 256
    ? {}
    : { providerRequestId: value };
}

function isTimeout(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "AbortError" || error.name === "TimeoutError");
}

function parseProviderVideo(data: Record<string, unknown>): ProviderVideo {
  const id = readString(data, "id");
  const projectId = readString(data, "project_id", "parent_id");
  const status = readString(data, "status").slice(0, 64);
  const title = readString(data, "title", "name").slice(0, 255);
  const embedLocator = optionalString(data, "embed_link", "embed_url", "play_link");
  if (id.length > 256 || projectId.length > 128 || (embedLocator?.length ?? 0) > 2_048) {
    throw new Error("Kinescope response exceeds supported field limits");
  }
  if (embedLocator !== null) assertKinescopeUrl(embedLocator, "embed locator");
  const message = optionalString(data, "message", "error")?.slice(0, 500) ?? null;
  const durationSeconds = normalizedDurationSeconds(data.duration);
  return {
    id,
    projectId,
    status,
    title,
    embedLocator,
    ...(durationSeconds === undefined ? {} : { durationSeconds }),
    ...(message === null ? {} : { message }),
  };
}

function normalizedDurationSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.round(value))
    : undefined;
}

function readString(data: Record<string, unknown>, ...keys: readonly string[]): string {
  const value = optionalString(data, ...keys);
  if (value === null) throw new Error(`Kinescope response misses ${keys[0] ?? "field"}`);
  return value;
}

function optionalString(data: Record<string, unknown>, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function assertKinescopeUrl(locator: string, kind: string): void {
  const url = new URL(locator);
  if (url.protocol !== "https:" || (url.hostname !== "kinescope.io" && !url.hostname.endsWith(".kinescope.io"))) {
    throw new Error(`Kinescope returned an unsafe ${kind}`);
  }
}
