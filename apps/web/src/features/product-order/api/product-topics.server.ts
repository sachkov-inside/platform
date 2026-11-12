import "server-only";
import { z } from "zod";
import { handleMutationOperation } from "@/shared/auth/index.server";
import { requestProductTopics } from "@/shared/api/backend/index.server";
import type {
  productTopicsInputSchema,
  ReorderProductResult,
} from "../model/presentation";
import { updateProductTopicsOperation } from "./product-order.operation";

const receipt = z.object({
  productId: z.uuid(),
  orderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
});
async function execute(
  input: z.output<typeof productTopicsInputSchema>,
  token: string,
): Promise<ReorderProductResult> {
  try {
    const result = await requestProductTopics(input, token);
    if (!result.ok)
      return result.response.status === 409
        ? { kind: "conflict" }
        : result.response.status === 403
          ? { kind: "forbidden" }
          : { kind: "error", reference: "product-topics-save" };
    const saved = receipt.safeParse(result.body);
    return saved.success && saved.data.productId === input.productId
      ? { kind: "saved", orderVersion: saved.data.orderVersion }
      : { kind: "error", reference: "product-topics-receipt" };
  } catch {
    return { kind: "error", reference: "product-topics-unavailable" };
  }
}
export function handleProductTopicsRequest(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, updateProductTopicsOperation, {
    execute,
    invalidInput: () => ({ kind: "error", reference: "product-topics-input" }),
  });
}
