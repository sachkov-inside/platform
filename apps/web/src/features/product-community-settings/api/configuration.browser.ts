import type { z } from "zod";
import {
  billingCommandPayload,
  billingCommandResult,
  readBillingEndpoint,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  productCommunityConfigurationSchema,
  configuredProductCommunitySchema,
} from "../model/configuration";
export function readProductCommunityConfiguration(productId: string) {
  return readBillingEndpoint(
    `/api/authoring/products/community?productId=${encodeURIComponent(productId)}`,
    productCommunityConfigurationSchema,
  );
}
export async function configureProductCommunity(
  input: z.infer<typeof productCommunityConfigurationSchema>,
) {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/authoring/products/community",
      "PUT",
      billingCommandPayload(input),
    ),
    configuredProductCommunitySchema,
  );
}
