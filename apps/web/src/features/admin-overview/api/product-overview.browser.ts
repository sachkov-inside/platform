import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import type { OverviewPeriodDays } from "../model/overview-contract";
import {
  productOverviewStateSchema,
  type ProductOverviewState,
} from "../model/product-overview";

export function productOverviewPath(
  productId: string,
  period: OverviewPeriodDays,
): string {
  return `/api/authoring/products/${encodeURIComponent(productId)}/overview?period=${String(period)}`;
}

/** Обзор продукта через BFF; отказ, отсутствие продукта и сбой остаются состояниями вкладки. */
export async function requestProductOverview(
  productId: string,
  period: OverviewPeriodDays,
  signal: AbortSignal,
): Promise<ProductOverviewState> {
  const result = await requestAuthenticatedRead(
    productOverviewPath(productId, period),
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = productOverviewStateSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : {
          kind: "unavailable",
          reference: result.reference ?? "product-overview",
        };
  }
  if (result.kind !== "ready")
    return {
      kind: "unavailable",
      reference: result.reference ?? "product-overview",
    };
  const parsed = productOverviewStateSchema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
