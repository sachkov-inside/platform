import "server-only";

import { readWebRuntimeConfig } from "@/shared/config/index.server";
import { webHttpSourceReadyKey } from "../../../runtime/http-metrics-config";

/** Enabled metrics must precede the first Node HTTP request, including startup queues. */
export function registerWebHttpSource(): void {
  if (!readWebRuntimeConfig().httpMetrics.enabled) return;
  const ready: unknown = Reflect.get(globalThis, webHttpSourceReadyKey);
  if (ready !== true) throw new Error("web_http_preload_required");
}
