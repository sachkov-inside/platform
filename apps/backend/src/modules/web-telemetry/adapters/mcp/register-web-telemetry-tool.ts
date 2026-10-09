import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { WebTelemetry } from "../../facets/web-telemetry/web-telemetry.js";

export function registerWebTelemetryTool(
  server: McpServer,
  dependencies: {
    readonly accountId: string;
    readonly telemetry: Pick<WebTelemetry, "summary">;
  },
): void {
  server.registerTool(
    "web_telemetry_summary",
    {
      title: "Read web performance and error summary",
      description:
        "Read UTC-day p75 LCP/INP/CLS, route/device coverage and digest/route error groups for 1–30 days. Requires platform:admin. Any dropped samples mark p75 incomplete. Sends nothing and changes no state.",
      inputSchema: z.strictObject({
        days: z.number().int().min(1).max(30).default(7),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ days }) => {
      const result = await dependencies.telemetry.summary(
        dependencies.accountId,
        days,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        ...(!result.ok ? { isError: true } : {}),
      };
    },
  );
}
