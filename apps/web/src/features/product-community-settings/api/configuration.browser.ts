import { configureProductCommunityOperation } from "./configuration.operation";
import { readBillingEndpoint } from "@/entities/subscription";
import { productCommunityConfigurationSchema } from "../model/configuration";
export function readProductCommunityConfiguration(productId: string) {
  return readBillingEndpoint(
    `/api/authoring/products/community?productId=${encodeURIComponent(productId)}`,
    productCommunityConfigurationSchema,
  );
}
export const configureProductCommunity =
  configureProductCommunityOperation.send;
