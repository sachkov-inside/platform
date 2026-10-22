import "server-only";

import { handleMutationOperation } from "@/shared/auth/index.server";

import { acceptTermsOperation } from "./accept-terms.operation";
import { executeAcceptTerms } from "./accept-terms.server";

/** Same-origin BFF экрана первого входа. */
export function handleAcceptTermsRequest(request: Request): Promise<Response> {
  return handleMutationOperation(request, acceptTermsOperation, {
    execute: (input, accessToken) => executeAcceptTerms(input, accessToken),
    invalidInput: () => ({ kind: "unavailable" }) as const,
  });
}
