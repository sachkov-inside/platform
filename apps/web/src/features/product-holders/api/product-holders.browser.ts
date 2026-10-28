import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  productHoldersSearch,
  productHoldersStateSchema,
  type ProductHoldersQuery,
  type ProductHoldersState,
} from "../model/product-holders";

export function productHoldersPath(query: ProductHoldersQuery): string {
  const search = productHoldersSearch(query);
  const path = `/api/authoring/products/${encodeURIComponent(query.productId)}/holders`;
  return search === "" ? path : `${path}?${search}`;
}

export async function requestProductHolders(
  query: ProductHoldersQuery,
  signal: AbortSignal,
): Promise<ProductHoldersState> {
  const result = await requestAuthenticatedRead(
    productHoldersPath(query),
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = productHoldersStateSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : {
          kind: "unavailable",
          reference: result.reference ?? "product-holders",
        };
  }
  if (result.kind !== "ready")
    return {
      kind: "unavailable",
      reference: result.reference ?? "product-holders",
    };
  const parsed = productHoldersStateSchema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
