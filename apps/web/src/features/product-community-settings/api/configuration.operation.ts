import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "@/entities/subscription";
import {
  configuredProductCommunitySchema,
  productCommunityConfigurationSchema,
} from "../model/configuration";

export const configureProductCommunityOperation = defineMutationOperation({
  input: productCommunityConfigurationSchema,
  method: "PUT",
  path: "/api/authoring/products/community",
  result: billingCommandResultSchema(configuredProductCommunitySchema),
  transportFailure: billingTransportFailure,
});
