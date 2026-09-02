import "server-only";

import { z } from "zod";

import type { ReorderSeriesResult } from "@/features/series-order";
import {
  requestSeriesReorder,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

const formSchema = z.object({
  expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  orderedMaterialIds: z.string().max(1_000_000),
  seriesId: z.uuid(),
});
const receiptSchema = z
  .object({ orderVersion: z.string().regex(/^[a-f0-9]{64}$/u), seriesId: z.uuid() })
  .strict();

export async function executeReorderSeries(
  formData: FormData,
  accessToken: string,
  request: typeof requestSeriesReorder = requestSeriesReorder,
): Promise<ReorderSeriesResult> {
  const parsed = formSchema.safeParse({
    expectedOrderVersion: formData.get("expectedOrderVersion"),
    orderedMaterialIds: formData.get("orderedMaterialIds"),
    seriesId: formData.get("seriesId"),
  });
  if (!parsed.success) return { kind: "error", reference: "series-order-form" };
  let materialIds: unknown;
  try {
    materialIds = JSON.parse(parsed.data.orderedMaterialIds) as unknown;
  } catch {
    return { kind: "error", reference: "series-order-form" };
  }
  const orderedMaterialIds = z.array(z.uuid()).safeParse(materialIds);
  if (!orderedMaterialIds.success) {
    return { kind: "error", reference: "series-order-form" };
  }

  let result: BackendTransportResult;
  try {
    result = await request(
      {
        expectedOrderVersion: parsed.data.expectedOrderVersion,
        orderedMaterialIds: orderedMaterialIds.data,
        seriesId: parsed.data.seriesId,
      },
      accessToken,
    );
  } catch {
    return { kind: "error", reference: "backend-unavailable" };
  }
  if (!result.ok) {
    if (result.response.status === 401 || result.response.status === 403) {
      return { kind: "unauthorized" };
    }
    if (result.response.status === 409) return { kind: "conflict" };
    return { kind: "error", reference: "series-order-save" };
  }
  const receipt = receiptSchema.safeParse(result.body);
  if (!receipt.success || receipt.data.seriesId !== parsed.data.seriesId) {
    return { kind: "error", reference: "series-order-receipt" };
  }
  return { kind: "saved", orderVersion: receipt.data.orderVersion };
}
