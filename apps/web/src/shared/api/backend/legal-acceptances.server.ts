import "server-only";

import { AccountsService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export type AcceptTermsRequest = Parameters<
  AccountsService["acceptTerms"]
>[0]["requestBody"];

/** Whether the terms of use in force are accepted, with the edition the first sign-in accepts. */
export function requestTermsAcceptance(accessToken: string) {
  return executeGeneratedRequest(
    (request) => new AccountsService(request).readTermsAcceptance(),
    200,
    { accessToken },
  );
}

export function requestAcceptTerms(
  requestBody: AcceptTermsRequest,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new AccountsService(request).acceptTerms({ requestBody }),
    200,
    { accessToken },
  );
}

/** The owner's acceptance journal, newest first. */
export function requestLegalAcceptances(accessToken: string) {
  return executeGeneratedRequest(
    (request) => new AccountsService(request).listLegalAcceptances(),
    200,
    { accessToken },
  );
}
