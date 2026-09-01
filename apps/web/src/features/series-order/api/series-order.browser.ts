import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  reorderSeriesResultSchema,
  type ReorderSeriesInput,
  type ReorderSeriesResult,
} from "../model/presentation";

export async function reorderSeries(
  input: ReorderSeriesInput,
): Promise<ReorderSeriesResult> {
  const formData = new FormData();
  formData.set("expectedOrderVersion", input.expectedOrderVersion);
  formData.set("orderedMaterialIds", JSON.stringify(input.orderedMaterialIds));
  formData.set("seriesId", input.seriesId);
  const result = await requestSameOriginMutation(
    "/api/authoring/series/order",
    "PUT",
    formData,
  );
  if (!result.ok) {
    return result.status === 401 || result.status === 403
      ? { kind: "unauthorized" }
      : { kind: "error", reference: `series-order-bff-${String(result.status)}` };
  }
  const parsed = reorderSeriesResultSchema.safeParse(result.body);
  return parsed.success
    ? parsed.data
    : { kind: "error", reference: "series-order-bff-contract" };
}
