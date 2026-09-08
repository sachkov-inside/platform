import "server-only";
import { AccountsService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export type StartBillingContactInput = Parameters<
  AccountsService["startBillingContact"]
>[0]["requestBody"];
export type ConfirmBillingContactInput = Parameters<
  AccountsService["confirmBillingContact"]
>[0]["requestBody"];
const billingContactSendTimeoutMs = 35_000;
export function requestBillingContact(accessToken: string) {
  return executeGeneratedRequest(
    (request) => new AccountsService(request).readBillingContact(),
    200,
    { accessToken },
  );
}
export function requestStartBillingContact(
  requestBody: StartBillingContactInput,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new AccountsService(request).startBillingContact({ requestBody }),
    200,
    { accessToken, timeoutMs: billingContactSendTimeoutMs },
  );
}
export function requestConfirmBillingContact(
  requestBody: ConfirmBillingContactInput,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new AccountsService(request).confirmBillingContact({ requestBody }),
    200,
    { accessToken },
  );
}
