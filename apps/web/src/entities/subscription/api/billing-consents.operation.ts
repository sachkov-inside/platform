import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  billingCommandResultSchema,
  billingTransportFailure,
} from "./billing-operation";
import {
  consentsInputSchema,
  consentsValueSchema,
} from "../model/legal-documents";

export const acceptBillingConsentsOperation = defineMutationOperation({
  input: consentsInputSchema,
  method: "POST",
  path: "/api/account/billing/consents",
  result: billingCommandResultSchema(consentsValueSchema),
  transportFailure: billingTransportFailure,
});
