import "server-only";
import { configureProductCommunityOperation } from "./configuration.operation";
import {
  billingFailureResponse,
  readAuthenticatedBilling,
  billingInvalidInput,
  executeBillingOperation,
} from "@/entities/subscription.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import {
  requestReadProductCommunityConfiguration,
  requestConfigureProductCommunity,
} from "@/shared/api/backend/index.server";
import {
  productCommunityConfigurationSchema,
  configuredProductCommunitySchema,
} from "../model/configuration";
export function handleReadProductCommunityConfiguration(
  request: Request,
): Promise<Response> {
  const productId =
    productCommunityConfigurationSchema.shape.productId.safeParse(
      new URL(request.url).searchParams.get("productId"),
    );
  if (!productId.success)
    return Promise.resolve(billingFailureResponse("invalid_request", 400));
  return readAuthenticatedBilling(
    (token) => requestReadProductCommunityConfiguration(productId.data, token),
    productCommunityConfigurationSchema,
  );
}
export function handleConfigureProductCommunity(
  request: Request,
): Promise<Response> {
  return handleMutationOperation(request, configureProductCommunityOperation, {
    invalidInput: billingInvalidInput,
    execute: (command, token) =>
      executeBillingOperation(
        command,
        configuredProductCommunitySchema,
        (input) =>
          requestConfigureProductCommunity(
            input.productId,
            { groupRef: input.groupRef },
            token,
          ),
      ),
  });
}
