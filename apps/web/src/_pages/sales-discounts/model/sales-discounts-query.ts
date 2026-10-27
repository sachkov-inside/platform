import type { Route } from "next";
import { z } from "zod";

import type { PromotionsFilter } from "@/features/promotions";

export const salesDiscountsRootHref = "/authoring/sales/discounts";

const productIdSchema = z.uuid();

/**
 * Подраздел и фильтр «Скидок» из адреса: `view=questionnaire`, `product`, `archived=1`. Архив
 * анкетных скидок фильтров не имеет: чужие параметры при нём отбрасываются.
 */
export function parseSalesDiscountsQuery(
  searchParams: URLSearchParams,
): PromotionsFilter {
  if (searchParams.get("view") === "questionnaire")
    return { view: "questionnaire", productId: null, archived: false };
  return {
    view: "promotions",
    productId:
      productIdSchema.safeParse(searchParams.get("product")).data ?? null,
    archived: searchParams.get("archived") === "1",
  };
}

export function salesDiscountsHref(filter: PromotionsFilter): Route {
  const params = new URLSearchParams();
  if (filter.view === "questionnaire") params.set("view", "questionnaire");
  else {
    if (filter.productId !== null) params.set("product", filter.productId);
    if (filter.archived) params.set("archived", "1");
  }
  const serialized = params.toString();
  return serialized === ""
    ? salesDiscountsRootHref
    : `${salesDiscountsRootHref}?${serialized}`;
}
