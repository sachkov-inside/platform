import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  listOwnerProductPricesInputSchema,
  ownerProductPriceOutcomeSchema,
} from "../model/product-sale";

/** Страница цен всех продуктов у владельца: `productPrices.list` без продукта, для списка продуктов. */
export const listOwnerProductPricesOperation = defineMutationOperation({
  input: listOwnerProductPricesInputSchema,
  method: "POST",
  path: "/api/authoring/billing/product-prices/list",
  result: billingCommandResultSchema(ownerProductPriceOutcomeSchema),
  transportFailure: billingTransportFailure,
});
