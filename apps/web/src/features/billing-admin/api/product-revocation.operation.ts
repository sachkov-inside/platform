import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  productRevocationCommandSchema,
  productRevocationPreviewResponseSchema,
  productRevocationResponseSchema,
  productRevocationTargetSchema,
} from "../model/product-revocation";

export const previewProductRevocationOperation = defineMutationOperation({
  input: productRevocationTargetSchema,
  method: "POST",
  path: "/api/authoring/access/products/preview-revoke",
  result: billingCommandResultSchema(productRevocationPreviewResponseSchema),
  transportFailure: billingTransportFailure,
});

export const revokeProductAccessOperation = defineMutationOperation({
  input: productRevocationCommandSchema,
  method: "POST",
  path: "/api/authoring/access/products/revoke",
  result: billingCommandResultSchema(productRevocationResponseSchema),
  transportFailure: billingTransportFailure,
});
