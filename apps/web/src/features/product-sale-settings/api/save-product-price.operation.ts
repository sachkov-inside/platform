import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  saveProductPriceInputSchema,
  catalogOutcomeSchema,
} from "../model/product-sale";

/** Цена и открытие продаж: команда `productPrices.save` с проверкой ревизии. */
export const saveProductPriceOperation = defineMutationOperation({
  input: saveProductPriceInputSchema,
  method: "POST",
  path: "/api/authoring/billing/product-prices/save",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
