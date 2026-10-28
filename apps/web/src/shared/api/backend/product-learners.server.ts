import "server-only";

import { AccessService } from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

/**
 * One page of a Product's holders, newest first, with learning progress and no names or emails.
 * `accountIds` narrows the page to those Accounts (at most 50); an Account without access is absent.
 */
export function requestProductHolders(
  query: Parameters<AccessService["listProductHolders"]>[0],
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new AccessService(request).listProductHolders(query),
    200,
    { accessToken },
  );
}
