import { z } from "zod";

import type { VideoProvider, ProviderVideo } from "../../ports/video-provider.js";

const initResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1).max(256),
    endpoint: z.url().max(2_048),
  }).loose(),
}).loose();

const providerResponseSchema = z.object({ data: z.record(z.string(), z.unknown()) }).loose();

export function createKinescopeVideoProvider(config: {
  readonly apiBaseUrl: string;
  readonly apiToken: string;
  readonly uploaderBaseUrl: string;
  readonly fetch?: typeof globalThis.fetch;
}): VideoProvider {
  const request = config.fetch ?? globalThis.fetch;
  const provider: VideoProvider = {
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
        signal: AbortSignal.timeout(8_000),
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
          signal: AbortSignal.timeout(8_000),
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
  return {
    id,
    projectId,
    status,
    title,
    embedLocator,
    ...(message === null ? {} : { message }),
  };
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
