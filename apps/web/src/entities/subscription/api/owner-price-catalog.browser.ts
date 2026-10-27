import {
  ownerPriceCatalogSchema,
  type OwnerPriceCatalog,
} from "../model/owner-price-catalog";
import {
  readBillingEndpoint,
  type BillingCommandResult,
} from "./billing-result.browser";

/** Адрес BFF полного каталога цен владельца. */
export const ownerPriceCatalogRoute = "/api/authoring/billing/catalog";

/** Полный каталог цен владельца через BFF; недоступность остаётся исходом, а не пустым списком. */
export function readOwnerPriceCatalog(): Promise<
  BillingCommandResult<OwnerPriceCatalog>
> {
  return readBillingEndpoint(ownerPriceCatalogRoute, ownerPriceCatalogSchema);
}
