import type { Route } from "next";
import { z } from "zod";

import {
  paymentLinkStateSchema,
  type PaymentLinksFilter,
} from "@/features/payment-links";

export const salesLinksRootHref = "/authoring/sales/links";

const productIdSchema = z.uuid();

/**
 * Фильтр списка ссылок из адреса: `product` и `state`. Чужое значение отбрасывается, а не
 * превращается в пустой список.
 */
export function parseSalesLinksQuery(
  searchParams: URLSearchParams,
): PaymentLinksFilter {
  return {
    productId:
      productIdSchema.safeParse(searchParams.get("product")).data ?? null,
    state:
      paymentLinkStateSchema.safeParse(searchParams.get("state")).data ?? null,
  };
}

export function salesLinksHref(filter: PaymentLinksFilter): Route {
  const params = new URLSearchParams();
  if (filter.productId !== null) params.set("product", filter.productId);
  if (filter.state !== null) params.set("state", filter.state);
  const serialized = params.toString();
  return serialized === ""
    ? salesLinksRootHref
    : `${salesLinksRootHref}?${serialized}`;
}
