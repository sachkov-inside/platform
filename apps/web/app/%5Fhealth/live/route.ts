import { readWebRuntimeConfig } from "@/shared/config/index.server";
import { webLiveness } from "@/shared/config/operational-readiness.server";

export function GET(): Response {
  return Response.json(webLiveness(readWebRuntimeConfig()), {
    headers: { "cache-control": "private, no-store" },
  });
}
