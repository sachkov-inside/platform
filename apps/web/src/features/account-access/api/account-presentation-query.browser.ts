import { createAccountPresentationQueryOptions } from "../model/account-presentation-query";
import { requestAccountPresentation } from "./request-account-presentation";

export function accountPresentationBrowserQueryOptions() {
  return createAccountPresentationQueryOptions(
    ({ signal }) => requestAccountPresentation(signal),
  );
}
