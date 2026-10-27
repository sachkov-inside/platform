import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";

import {
  archiveProductPriceInputSchema,
  catalogOutcomeSchema,
} from "../model/product-sale";

/** Архив цены продукта: команда `productPrices.archive`; полученный доступ не меняется. */
export const archiveProductPriceOperation = defineMutationOperation({
  input: archiveProductPriceInputSchema,
  method: "POST",
  path: "/api/authoring/billing/product-prices/archive",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
