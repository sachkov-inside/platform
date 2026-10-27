import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  readOwnerProductPriceInputSchema,
  ownerProductPriceOutcomeSchema,
} from "../model/product-sale";

/** Цена одного продукта у владельца: `productPrices.list` с `productId`, без перебора каталога. */
export const readOwnerProductPriceOperation = defineMutationOperation({
  input: readOwnerProductPriceInputSchema,
  method: "POST",
  path: "/api/authoring/billing/product-prices/read",
  result: billingCommandResultSchema(ownerProductPriceOutcomeSchema),
  transportFailure: billingTransportFailure,
});
