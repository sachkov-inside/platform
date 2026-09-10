import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { isOwnerReadOperation, ownerOperationSchema } from "../../domain/owner-operations.js";
import type { BillingOperations } from "../../facets/billing-operations/billing-operations.js";

export type BillingOwnerTools = Pick<BillingOperations, "execute">;
// Предпросмотр партии пишет только свою строку предпросмотра и ничего не выдаёт.
const nonDestructiveWrites = ["grants.previewBatch"];

/**
 * Владельческие billing-инструменты MCP. Каждый инструмент — та же операция, что и в admin
 * endpoint, с теми же полномочиями, идемпотентностью и проверкой revision.
 */
export function registerBillingTools(server: McpServer, dependencies: {
  readonly accountId: string;
  readonly billing: BillingOwnerTools;
}): void {
  for (const option of ownerOperationSchema.options) {
    const operation = option.shape.operation.value;
    // Инструмент называет операцию собой: сам дискриминатор не входит в аргументы модели.
    const inputSchema = withoutOperation(option.shape);
    server.registerTool(`billing_${operation.replaceAll(".", "_")}`, {
      title: operation,
      description: description(operation),
      inputSchema,
      annotations: { readOnlyHint: isOwnerReadOperation(operation),
        destructiveHint: !isOwnerReadOperation(operation) && !nonDestructiveWrites.includes(operation),
        idempotentHint: true, openWorldHint: operation.startsWith("refunds.") || operation === "payments.reconcile" },
    }, async input => toolResult(dependencies.billing.execute(dependencies.accountId, { ...input, operation })));
  }
}

function withoutOperation(shape: z.ZodRawShape): z.ZodObject<z.ZodRawShape> {
  return z.strictObject(Object.fromEntries(Object.entries(shape).filter(([key]) => key !== "operation")));
}

function description(operation: string): string {
  switch (operation) {
    case "refunds.decide":
      return "Record a refund decision: amount, whether access is kept or revoked, and whether renewal is cancelled. Sends nothing to the bank and never revokes access by itself. Reuse operationId on retry.";
    case "refunds.execute":
      return "Send the decided refund to the bank with decisionRef and expectedRevision. This is a real external money operation: the amount comes from the decision and cannot be changed here. A lost response stays unknown and is reconciled by the same attempt, never resent as a new refund.";
    case "refunds.read":
      return "Read refund decisions, their bank attempts and the remaining refundable amount for one payment. Sends nothing.";
    case "payments.reconcile":
      return "Re-read one payment from the bank and apply its verified result. Never starts a new payment or charge.";
    case "payments.list": case "payments.read":
      return "Read stored payments, their bank state, paid conditions, access readiness and owner audit. Sends nothing; card bindings and receipt contacts are not exposed.";
    case "subscriptions.cancel":
      return "Stop future charges for one Account's subscription with expectedRevision. The paid term is preserved and an already sent charge is reconciled separately.";
    case "grants.read":
      return "Read one Account's access grants with source, term and change history. Sends nothing.";
    case "grants.previewBatch":
      return "Check a manual grant batch against confirmed identities before granting anything. Grants no access.";
    case "grants.applyBatch":
      return "Apply the confirmed rows of a previously previewed batch with previewRef and expectedRevision. Changed identity mapping makes the preview stale instead of guessing.";
    case "grants.extend":
      return "Extend one manual or legacy grant to a later end or explicit lifetime with expectedRevision. Paid periods belong to billing and are not editable here.";
    case "grants.revoke":
      return "Revoke one manual or legacy grant with expectedRevision. Other valid grounds of the same Account stay in force.";
    default:
      return `Change the billing catalog through ${operation} with expectedRevision. Purchased conditions, existing subscriptions and issued grants are never rewritten. Reuse operationId on retry.`;
  }
}

async function toolResult(pending: Promise<{ readonly ok: boolean }>): Promise<CallToolResult> {
  const result = await pending;
  return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, ...(!result.ok ? { isError: true } : {}) };
}
