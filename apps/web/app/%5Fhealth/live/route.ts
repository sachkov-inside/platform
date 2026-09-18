import { connection } from "next/server";

import { readWebRuntimeConfig } from "@/shared/config/index.server";
import { webLiveness } from "@/shared/config/operational-readiness.server";

/** `connection()` держит ответ вне сборки: живость читается у работающего процесса (ADR 0026). */
export async function GET(): Promise<Response> {
  await connection();
  return Response.json(webLiveness(readWebRuntimeConfig()), {
    headers: { "cache-control": "private, no-store" },
  });
}
