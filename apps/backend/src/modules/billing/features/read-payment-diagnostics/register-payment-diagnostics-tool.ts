import type { McpServer } from "@modelcontextprotocol/server";
import {
  type PaymentDiagnostics,
  paymentDiagnosticsQuerySchema,
} from "./payment-diagnostics.js";

export function registerPaymentDiagnosticsTool(
  server: McpServer,
  dependencies: {
    readonly accountId: string;
    readonly diagnostics: Pick<PaymentDiagnostics, "read">;
  },
): void {
  server.registerTool(
    "payment_access_diagnostics",
    {
      title: "Read confirmed payment and paid grant diagnostics",
      description:
        "Requires platform:admin. Read a UTC [from,to) window of at most 31 days, with explicit Moscow calendar timezone. Returns at most 50 confirmed payments, exact paid-source grants, refunds and continuation. Counts describe this page. Granted means the paid source exists, not that access is currently active; expiry/revocation are separate. Partial/unknown and source failure are not zero. Traversal is live, not an atomic cross-module snapshot. No provider calls or mutations.",
      inputSchema: paymentDiagnosticsQuerySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await dependencies.diagnostics.read(
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
