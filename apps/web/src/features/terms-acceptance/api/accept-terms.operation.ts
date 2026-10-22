import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  acceptTermsInputSchema,
  acceptTermsResultSchema,
} from "../model/terms-acceptance";

/** Accepts the terms edition the first-sign-in screen showed. */
export const acceptTermsOperation = defineMutationOperation({
  input: acceptTermsInputSchema,
  method: "POST",
  path: "/api/account/terms",
  result: acceptTermsResultSchema,
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? ({ kind: "unauthorized" } as const)
      : ({ kind: "unavailable" } as const),
});
