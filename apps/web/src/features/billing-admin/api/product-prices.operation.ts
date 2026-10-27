import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import { catalogOutcomeSchema } from "../model/admin-operations";
import {
  saveProductPriceSchema,
  archiveProductPriceSchema,
} from "../model/product-prices";
export const saveProductPriceOperation = defineMutationOperation({
  input: saveProductPriceSchema,
  method: "POST",
  path: "/api/authoring/billing/product-prices/save",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
export const archiveProductPriceOperation = defineMutationOperation({
  input: archiveProductPriceSchema,
  method: "POST",
  path: "/api/authoring/billing/product-prices/archive",
  result: billingCommandResultSchema(catalogOutcomeSchema),
  transportFailure: billingTransportFailure,
});
