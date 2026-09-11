import "server-only";
import { BillingService, AccountsService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

type BillingRequest<Method extends Exclude<keyof BillingService, "httpRequest">> = Parameters<
  BillingService[Method]
>[0];

/**
 * Команды, доходящие до банка, ждут его ответа на сервере: бюджет чуть больше, чем у самого
 * банковского вызова, поэтому браузер не начинает вторую покупку из-за таймаута транспорта.
 */
const bankCommandTimeoutMs = 30_000;

export function requestBillingOffers(
  query: BillingRequest<"billingOffers">,
  accessToken?: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).billingOffers(query),
    200,
    accessToken === undefined ? {} : { accessToken },
  );
}
export function requestCurrentBilling(accessToken: string) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).currentBilling(),
    200,
    { accessToken },
  );
}
export function requestBillingQuote(
  requestBody: BillingRequest<"quoteBillingPurchase">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).quoteBillingPurchase({ requestBody }),
    200,
    { accessToken },
  );
}
export function requestBillingConsents(
  requestBody: Parameters<AccountsService["acceptBillingConsents"]>[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new AccountsService(request).acceptBillingConsents({ requestBody }),
    200,
    { accessToken },
  );
}
export function requestBillingPurchase(
  requestBody: BillingRequest<"purchaseBillingSubscription">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new BillingService(request).purchaseBillingSubscription({ requestBody }),
    200,
    { accessToken, timeoutMs: bankCommandTimeoutMs },
  );
}
export function requestBillingPurchaseStatus(
  purchaseRef: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).readBillingPurchase({ purchaseRef }),
    200,
    { accessToken },
  );
}
export function requestCancelBillingRenewal(
  requestBody: BillingRequest<"cancelBillingRenewal">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).cancelBillingRenewal({ requestBody }),
    200,
    { accessToken },
  );
}
export function requestResumeBillingRenewal(
  requestBody: BillingRequest<"resumeBillingRenewal">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).resumeBillingRenewal({ requestBody }),
    200,
    { accessToken },
  );
}
export function requestBillingChangeQuote(
  requestBody: BillingRequest<"quoteBillingChange">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).quoteBillingChange({ requestBody }),
    200,
    { accessToken },
  );
}
export function requestBillingChange(
  requestBody: BillingRequest<"changeBillingOption">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).changeBillingOption({ requestBody }),
    200,
    { accessToken, timeoutMs: bankCommandTimeoutMs },
  );
}
export function requestCancelBillingChange(
  requestBody: BillingRequest<"cancelBillingChange">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).cancelBillingChange({ requestBody }),
    200,
    { accessToken },
  );
}
export function requestChangeBillingMethod(
  requestBody: BillingRequest<"changeBillingMethod">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).changeBillingMethod({ requestBody }),
    200,
    { accessToken, timeoutMs: bankCommandTimeoutMs },
  );
}
export function requestRevokeBillingMethod(
  requestBody: BillingRequest<"revokeBillingMethod">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).revokeBillingMethod({ requestBody }),
    200,
    { accessToken },
  );
}
export type ManageBillingCommand = BillingRequest<"manageBilling">["requestBody"];

/**
 * Владельческая поверхность: одна операция за вызов. BFF даёт каждой операции собственный
 * маршрут, поэтому дискриминатор не превращается в универсальный прокси браузера.
 */
export function requestManageBilling(
  requestBody: BillingRequest<"manageBilling">["requestBody"],
  accessToken: string,
  options: { readonly bankCommand?: boolean } = {},
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).manageBilling({ requestBody }),
    200,
    options.bankCommand === true
      ? { accessToken, timeoutMs: bankCommandTimeoutMs }
      : { accessToken },
  );
}
