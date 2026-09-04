import { readWebRuntimeConfig } from "@/shared/config/index.server";
import { webReadiness } from "@/shared/config/operational-readiness.server";

export async function GET(): Promise<Response> {
  try {
    return Response.json(await webReadiness(readWebRuntimeConfig()), {
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return Response.json(
      { code: "dependency_unavailable", status: 503 },
      {
        status: 503,
        headers: { "cache-control": "private, no-store" },
      },
    );
  }
}
