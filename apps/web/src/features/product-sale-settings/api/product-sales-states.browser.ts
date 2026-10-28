import {
  productSalesStatesSchema,
  readBillingEndpoint,
  type BillingCommandResult,
  type ProductSalesState,
} from "@/entities/subscription";

/** Адрес BFF публичных состояний продажи для владельца: весь каталог или один продукт. */
export const productSalesStatesRoute =
  "/api/authoring/billing/product-sales-states";

/**
 * Состояния продажи всех продуктов или, с `productId`, одного продукта. Маршрут читает все
 * страницы сам; недоступность остаётся исходом, а не пустым списком.
 */
export function readProductSalesStates(
  productId?: string,
): Promise<BillingCommandResult<ProductSalesState[]>> {
  return readBillingEndpoint(
    productId === undefined
      ? productSalesStatesRoute
      : `${productSalesStatesRoute}?${new URLSearchParams({ productId }).toString()}`,
    productSalesStatesSchema.shape.items,
  );
}
