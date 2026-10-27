import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  isOwnerReadOperation,
  ownerOperationSchema,
} from "../../domain/owner-operations.js";
import type { BillingOperations } from "../../facets/billing-operations/billing-operations.js";

export type BillingOwnerTools = Pick<BillingOperations, "execute">;
// Предпросмотр партии пишет только свою строку предпросмотра и ничего не выдаёт.
const nonDestructiveWrites: readonly string[] = [];

/**
 * Владельческие billing-инструменты MCP. Каждый инструмент — та же операция, что и в admin
 * endpoint, с теми же полномочиями, идемпотентностью и проверкой revision.
 */
export function registerBillingTools(
  server: McpServer,
  dependencies: {
    readonly accountId: string;
    readonly billing: BillingOwnerTools;
  },
): void {
  for (const option of ownerOperationSchema.options) {
    const operation = option.shape.operation.value;
    // Инструмент называет операцию собой: сам дискриминатор не входит в аргументы модели.
    const inputSchema = withoutOperation(option.shape);
    server.registerTool(
      `billing_${operation.replaceAll(".", "_")}`,
      {
        title: operation,
        description: description(operation),
        inputSchema,
        annotations: {
          readOnlyHint: isOwnerReadOperation(operation),
          destructiveHint:
            !isOwnerReadOperation(operation) &&
            !nonDestructiveWrites.includes(operation),
          idempotentHint: true,
          openWorldHint:
            operation.startsWith("refunds.") ||
            operation === "payments.reconcile",
        },
      },
      async (input) =>
        toolResult(
          dependencies.billing.execute(dependencies.accountId, {
            ...input,
            operation,
          }),
        ),
    );
  }
}

function withoutOperation(shape: z.ZodRawShape): z.ZodObject<z.ZodRawShape> {
  return z.strictObject(
    Object.fromEntries(
      Object.entries(shape).filter(([key]) => key !== "operation"),
    ),
  );
}

function description(operation: string): string {
  switch (operation) {
    case "paymentLinks.create":
      return "Create a transferable single-use payment link for a one-time Product using a final RUB amount in kopecks or an integer discount percentage and optional expiration. Closing Product sales also blocks payment through this link. Preserves catalog and existing purchases; sends no message and starts no payment. Zero-price access uses manual grants.";
    case "paymentLinks.revoke":
      return "Revoke an individual payment link before payment starts, with expectedRevision. A reserved or uncertain payment blocks revocation; successful purchases remain intact.";
    case "paymentLinks.list":
      return "List issued individual payment links newest first with their current status, optionally for one productId and one visible state, with cursor and limit. Contains bearer URLs: show only to the authorized owner. Sends nothing.";
    case "promotions.list":
      return "List Promotions newest first by start with their usage count. archived and questionnaire each select one side (both default false); productId selects Promotions that apply to that Product, including those for every Product. legacy marks an archived Promotion whose old offer scope did not move to Products: its empty productIds does not mean every Product. Sends nothing.";
    case "refunds.read":
      return "Read refund decisions, their bank attempts and the remaining refundable amount for one payment. Sends nothing.";
    case "payments.reconcile":
      return "Re-read one payment from the bank and apply its verified result. Never starts a new payment or charge.";
    case "payments.list":
      return "List stored payments newest first, optionally by accountId, productId, kind, one state or several states, and a creation period [from, to). Card bindings and receipt contacts are not exposed. Sends nothing.";
    case "payments.read":
      return "Read stored payments, their bank state, paid conditions, access readiness and owner audit. Sends nothing; card bindings and receipt contacts are not exposed.";
    case "respondents.import":
      return "Add Telegram usernames from the survey column to the private respondent list. Accepts @nick, nick and t.me links one per line; duplicates collapse and unrecognized lines are only counted. Never removes names. The owner audit stores counts, not names.";
    case "respondents.issue":
      return "Issue one survey respondent a personal one-time promo code copied from an archived, unexpired template promotion. A username gets at most one code; a repeat returns the issued one. Returns the product slug when the template sells one product; the payment page is /products/<slug>/buy?promo=<code>. Grants no access and sends nothing.";
    case "respondents.status":
      return "Read the survey respondent list: its size, issued personal links and purchases confirmed by them. Sends nothing.";
    default:
      return `Change the billing catalog through ${operation} with expectedRevision. Purchased conditions, existing subscriptions and issued grants are never rewritten. Reuse operationId on retry.`;
  }
}

async function toolResult(
  pending: Promise<{ readonly ok: boolean }>,
): Promise<CallToolResult> {
  const result = await pending;
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result,
    ...(!result.ok ? { isError: true } : {}),
  };
}
