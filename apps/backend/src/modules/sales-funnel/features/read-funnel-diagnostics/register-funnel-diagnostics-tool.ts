import type { McpServer } from "@modelcontextprotocol/server";
import type { SalesFunnel } from "../../facets/sales-funnel/sales-funnel.js";
import { funnelDiagnosticsQuerySchema } from "./read-funnel-diagnostics.js";

export function registerFunnelDiagnosticsTool(
  server: McpServer,
  dependencies: {
    readonly accountId: string;
    readonly funnel: Pick<SalesFunnel, "readDiagnostics">;
  },
): void {
  server.registerTool(
    "sales_funnel_diagnostics",
    {
      title: "Read bounded sales funnel diagnostics",
      description:
        "Requires platform:admin. Same entry-cohort and confirmed-sales definitions as the owner report (#816/#818); [from,to) at most 31 days, UTC instants/Europe/Moscow calendar. Rows page at most 50 sources; totals describe the entire bounded cohort. Owners bound relevant candidates/results to 2000 Accounts/contacts per dimension, the current Product catalogue to 200 and its relevant composition rows to 2000 per kind, and first-open requests to 1000 Material IDs. Owner snapshots use 2s statement/5s transaction/1s connection budgets. Survey uploaded/issued remain full global scalar counts; paid follows the selected Product/payment window (#818); overflow reports source_budget_exceeded and unknown, never truncated counts. Independent owner snapshots/live continuation; bot freshness is not proven by query success. Read only, no provider calls.",
      inputSchema: funnelDiagnosticsQuerySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await dependencies.funnel.readDiagnostics(
        dependencies.accountId,
        input,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        ...(!result.ok ? { isError: true } : {}),
      };
    },
  );
}
