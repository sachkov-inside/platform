import { z } from "zod";
import { defineMutationOperation } from "@/shared/api/mutation-operation";
import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "./billing-operation";
import {
  changeProductAccessSchema,
  issueProductAccessSchema,
  productAccessSchema,
} from "../model/product-access";
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
