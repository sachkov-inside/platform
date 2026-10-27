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

/** Filters of the people list as the generated client declares them; the cursor keeps them. */
export type PeopleListQuery = NonNullable<
  Parameters<PeopleService["listPeople"]>[0]
>;

/** The owner's people list with filters, total and a keyset cursor; `billing:manage` only. */
export function requestPeopleList(
  query: PeopleListQuery,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new PeopleService(request).listPeople(query),
    200,
    { accessToken },
  );
}

/** The person card; each block answers on its own. `billing:manage` only. */
export function requestPersonCard(
  accountId: string,
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new PeopleService(request).readPerson({ accountId }),
    200,
    { accessToken },
  );
}

/** Products the owner may grant or filter people by, archived ones included; `billing:manage` only. */
export function requestPeopleProductChoices(
  accessToken: string,
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new PeopleService(request).listPeopleProductChoices(),
    200,
    { accessToken },
  );
}
