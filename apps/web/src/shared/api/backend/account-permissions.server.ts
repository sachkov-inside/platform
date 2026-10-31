import "server-only";

import { AccountsService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

/** Effective permissions of the current Account; `platform:admin` lists every permission. */
export function requestCurrentAccountPermissions(accessToken: string) {
  return executeGeneratedRequest(
    (request) => new AccountsService(request).listCurrentAccountPermissions(),
    200,
    { accessToken },
  );
}
