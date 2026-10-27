import { z } from "zod";
import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "./billing-operation";
import {
  accessPairSchema,
  changeProductAccessSchema,
  issueProductAccessSchema,
  listProductAccessSchema,
  productAccessSchema,
  productAccessDetailSchema,
} from "../model/product-access";
export const listProductAccessOperation = defineMutationOperation({
  input: listProductAccessSchema,
  method: "POST",
  path: "/api/authoring/access/products/list",
  result: billingCommandResultSchema(
    z.object({
      ok: z.boolean(),
      value: z.array(productAccessSchema),
      nextCursor: z.string().nullable(),
    }),
  ),
  transportFailure: billingTransportFailure,
});
export const readProductAccessOperation = defineMutationOperation({
  input: accessPairSchema,
  method: "POST",
  path: "/api/authoring/access/products/read",
  result: billingCommandResultSchema(
    z.object({ ok: z.boolean(), value: productAccessDetailSchema }),
  ),
  transportFailure: billingTransportFailure,
});
export const issueProductAccessOperation = defineMutationOperation({
  input: issueProductAccessSchema,
  method: "POST",
  path: "/api/authoring/access/products/issue",
  result: billingCommandResultSchema(
    z.object({
      ok: z.boolean(),
      outcome: z.enum(["issued", "already_active", "revoked"]),
      value: productAccessSchema,
    }),
  ),
  transportFailure: billingTransportFailure,
});
export const restoreProductAccessOperation = defineMutationOperation({
  input: changeProductAccessSchema,
  method: "POST",
  path: "/api/authoring/access/products/restore",
  result: billingCommandResultSchema(
    z.object({ ok: z.boolean(), value: productAccessSchema }),
  ),
  transportFailure: billingTransportFailure,
});
