import type { z } from "zod";
import {
  billingCommandPayload,
  billingCommandResult,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  productRevocationPreviewResponseSchema,
  productRevocationResponseSchema,
  type productRevocationCommandSchema,
  type productRevocationTargetSchema,
} from "../model/product-revocation";
export async function previewProductRevocation(
  input: z.infer<typeof productRevocationTargetSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/access/products/preview-revoke",
      "POST",
      billingCommandPayload(input),
    ),
    productRevocationPreviewResponseSchema,
  );
}
export async function revokeProductAccess(
  input: z.infer<typeof productRevocationCommandSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/access/products/revoke",
      "POST",
      billingCommandPayload(input),
    ),
    productRevocationResponseSchema,
  );
}
