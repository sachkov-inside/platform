import { createAccountProfileQueryOptions } from "../model/account-profile-query";
import { requestAccountProfile } from "./request-account-profile";

export function accountProfileBrowserQueryOptions() {
  return createAccountProfileQueryOptions(
    ({ signal }) => requestAccountProfile(signal),
  );
}
