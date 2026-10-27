import "server-only";

import { PeopleService } from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

/** People for the owner by Account ID, exact email or Telegram name; `billing:manage` only. */
export function requestPeopleSearch(
  query: { readonly text: string; readonly limit?: number },
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new PeopleService(request).searchPeople({
        query: query.text,
        ...(query.limit === undefined ? {} : { limit: query.limit }),
      }),
    200,
    { accessToken },
  );
}

/** How the owner sees up to 100 known Accounts; a visitor is omitted. `billing:manage` only. */
export function requestPeopleIdentities(
  accountIds: readonly string[],
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new PeopleService(request).readPeopleIdentities({
        accountIds: accountIds.join(","),
      }),
    200,
    { accessToken },
  );
}
