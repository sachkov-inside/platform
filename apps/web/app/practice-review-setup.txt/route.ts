import { connection } from "next/server";

import { practiceReviewSetupText } from "@/_pages/material-reader";
import { readWebRuntimeConfig } from "@/shared/config/index.server";

/** Инструкция подключения агента; адрес учебного MCP берётся из конфигурации web (#938). */
export async function GET(): Promise<Response> {
  await connection();
  return new Response(
    practiceReviewSetupText(readWebRuntimeConfig().learnerMcp),
    {
      headers: {
        "cache-control": "public, max-age=300",
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}
