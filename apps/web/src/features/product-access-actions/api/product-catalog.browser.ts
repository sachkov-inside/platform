import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";

import {
  accessProductCatalogSchema,
  type AccessProductCatalog,
} from "../model/product-catalog";

export const accessProductCatalogPath =
  "/api/authoring/access/products/catalog";

/** Каталог продуктов через BFF; любой сбой остаётся состоянием, а не исключением. */
export async function requestAccessProductCatalog(
  signal: AbortSignal,
): Promise<AccessProductCatalog> {
  const result = await requestAuthenticatedRead(
    accessProductCatalogPath,
    signal,
  );
  if (result.kind === "authentication_required") return { kind: "signed_out" };
  if (result.kind === "rejected") {
    const parsed = accessProductCatalogSchema.safeParse(result.body);
    return parsed.success && parsed.data.kind !== "ready"
      ? parsed.data
      : { kind: "unavailable", reference: result.reference ?? "catalog" };
  }
  if (result.kind !== "ready")
    return { kind: "unavailable", reference: result.reference ?? "catalog" };
  const parsed = accessProductCatalogSchema.safeParse(result.value);
  return parsed.success && parsed.data.kind === "ready"
    ? parsed.data
    : { kind: "unavailable", reference: "malformed-response" };
}
