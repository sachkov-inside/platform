import type {
  ReorderSeriesInput,
  ReorderSeriesResult,
} from "../model/presentation";
import { reorderSeriesOperation } from "./series-order.operation";

export function reorderSeries(
  input: ReorderSeriesInput,
): Promise<ReorderSeriesResult> {
  const { confirmedProductRemovals, ...order } = input;
  // Пустое подтверждение не отправляется: команда без него ничего не снимает из купленных продуктов.
  return reorderSeriesOperation.send(
    confirmedProductRemovals === undefined ||
      confirmedProductRemovals.length === 0
      ? order
      : { ...order, confirmedProductRemovals },
  );
}
