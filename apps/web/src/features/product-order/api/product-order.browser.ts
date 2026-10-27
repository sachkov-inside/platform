import type {
  ReorderProductInput,
  ReorderProductResult,
} from "../model/presentation";
import { reorderProductOperation } from "./product-order.operation";

export function reorderProduct(
  input: ReorderProductInput,
): Promise<ReorderProductResult> {
  const { confirmedProductRemovals, ...order } = input;
  // Пустое подтверждение не отправляется: команда без него ничего не снимает из купленных продуктов.
  return reorderProductOperation.send(
    confirmedProductRemovals === undefined ||
      confirmedProductRemovals.length === 0
      ? order
      : { ...order, confirmedProductRemovals },
  );
}
