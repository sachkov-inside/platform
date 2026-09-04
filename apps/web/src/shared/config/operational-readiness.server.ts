import "server-only";

import { getBackendReadiness } from "@/shared/api/backend/index.server";
import type { WebRuntimeConfig } from "./runtime-config.server";

export function webLiveness(config: WebRuntimeConfig) {
  return {
    process: "web" as const,
    release: config.runtime,
    status: "alive" as const,
  };
}

export async function webReadiness(
  config: WebRuntimeConfig,
  readApiReadiness: typeof getBackendReadiness = getBackendReadiness,
) {
  const api = await readApiReadiness();
  if (
    api.release.release !== config.runtime.release ||
    api.release.sourceSha !== config.runtime.sourceSha
  ) {
    throw new Error("Web and API release identities do not match");
  }
  return {
    dependencies: { api: "ready" as const },
    process: "web" as const,
    release: config.runtime,
    schema: api.schema,
    status: "ready" as const,
  };
}
