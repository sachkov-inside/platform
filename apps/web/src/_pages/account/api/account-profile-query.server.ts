import "server-only";

import { createAccountProfileQueryOptions } from "../model/account-profile-query";
import { getPrivateMemberProfile } from "./get-private-member-profile";

export function accountProfileServerQueryOptions(
  viewerScope: string,
  accessToken: string,
) {
  return createAccountProfileQueryOptions(
    () => getPrivateMemberProfile(accessToken),
    viewerScope,
  );
}
