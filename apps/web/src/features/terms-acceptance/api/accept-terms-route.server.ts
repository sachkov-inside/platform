import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeAcceptTerms } from "./accept-terms.server";

/** Same-origin BFF экрана первого входа. */
export function handleAcceptTermsRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, (form, accessToken) =>
    executeAcceptTerms(form, accessToken),
  );
}
