import "server-only";
import {
  BillingService,
  AccountsService,
  TelegramCommunityService,
  AccessService,
} from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

type BillingRequest<
  Method extends Exclude<keyof BillingService, "httpRequest">,
> = Parameters<BillingService[Method]>[0];

/**
 * Команды, доходящие до банка, ждут его ответа на сервере: бюджет чуть больше, чем у самого
 * банковского вызова, поэтому браузер не начинает вторую покупку из-за таймаута транспорта.
 */
const bankCommandTimeoutMs = 30_000;

export function requestBillingOffers(
  query: {
    readonly productId?: string;
    readonly cursor?: string;
    readonly limit?: number;
  },
  accessToken?: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).productPrices(query),
    200,
    accessToken === undefined ? {} : { accessToken },
  );
}
/** Потоки продуктов публичны: запрос идёт без токена и одинаков для всех. */
export function requestProductCohorts(productId?: string, cursor?: string) {
  return executeGeneratedRequest(
    (request) =>
      new BillingService(request).billingProductCohorts({
        ...(productId === undefined ? {} : { productId }),
        ...(cursor === undefined ? {} : { cursor }),
      }),
    200,
    {},
  );
}
export function requestCurrentBilling(accessToken: string) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).readOwnBilling(),
    200,
    { accessToken },
  );
}
export function requestBillingQuote(
  requestBody: BillingRequest<"quoteBillingPurchase">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new BillingService(request).quoteBillingPurchase({ requestBody }),
    200,
    { accessToken },
  );
}
export function requestBillingConsents(
  requestBody: Parameters<
    AccountsService["acceptBillingConsents"]
  >[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new AccountsService(request).acceptBillingConsents({ requestBody }),
    200,
    { accessToken },
  );
}
export function requestBillingPurchase(
  requestBody: BillingRequest<"purchaseProduct">["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).purchaseProduct({ requestBody }),
    200,
    { accessToken, timeoutMs: bankCommandTimeoutMs },
  );
}
export function requestBillingPurchaseStatus(
  purchaseRef: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new BillingService(request).readBillingPurchase({ purchaseRef }),
    200,
    { accessToken },
  );
}
export function requestRestoreProductPurchase(
  productId: string,
  accessToken: string,
  purchaseRef?: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new BillingService(request).restoreProductPurchase({
        productId,
        ...(purchaseRef === undefined ? {} : { purchaseRef }),
      }),
    200,
    { accessToken },
  );
}
export type ManageBillingCommand =
  BillingRequest<"manageBilling">["requestBody"];

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

export function requestCurrentCommunityAdmission(accessToken: string) {
  return executeGeneratedRequest(
    (request) =>
      new TelegramCommunityService(request).currentCommunityAdmission(),
    200,
    { accessToken },
  );
}

export function requestCurrentCommunityEntry(
  accessToken: string,
  productId?: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new TelegramCommunityService(request).currentCommunityEntry(
        productId === undefined ? {} : { productId },
      ),
    200,
    { accessToken },
  );
}

export function requestPreviewProductRevocation(
  requestBody: Parameters<
    AccessService["previewProductAccessRevocation"]
  >[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new AccessService(request).previewProductAccessRevocation({
        requestBody,
      }),
    200,
    { accessToken },
  );
}
export function requestRevokeProductAccess(
  requestBody: Parameters<
    AccessService["revokeProductAccess"]
  >[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new AccessService(request).revokeProductAccess({ requestBody }),
    200,
    { accessToken },
  );
}

export function requestReadProductCommunityConfiguration(
  productId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new TelegramCommunityService(request).readProductCommunityConfiguration({
        productId,
      }),
    200,
    { accessToken },
  );
}
export function requestConfigureProductCommunity(
  productId: string,
  requestBody: Parameters<
    TelegramCommunityService["configureProductCommunity"]
  >[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new TelegramCommunityService(request).configureProductCommunity({
        productId,
        requestBody,
      }),
    200,
    { accessToken },
  );
}

/** Fresh optional-auth admission only: no programme/cohort assembly or cross-request cache. */
export function requestProductSaleAvailability(
  productIds: readonly string[],
  accessToken?: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new BillingService(request).billingProductSaleAvailability({
        productId: [...productIds],
      }),
    200,
    accessToken === undefined ? {} : { accessToken },
  );
}

export function requestBillingPaymentLink(id: string) {
  return executeGeneratedRequest(
    (request) => new BillingService(request).readBillingPaymentLink({ id }),
    200,
    {},
  );
}

export function requestListProductAccess(
  requestBody: Parameters<AccessService["listProductAccess"]>[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new AccessService(request).listProductAccess({ requestBody }),
    200,
    { accessToken },
  );
}

export function requestReadProductAccess(
  requestBody: Parameters<AccessService["readProductAccess"]>[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new AccessService(request).readProductAccess({ requestBody }),
    200,
    { accessToken },
  );
}

export function requestIssueProductAccess(
  requestBody: Parameters<
    AccessService["issueProductAccess"]
  >[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) => new AccessService(request).issueProductAccess({ requestBody }),
    200,
    { accessToken },
  );
}

export function requestRestoreProductAccess(
  requestBody: Parameters<
    AccessService["restoreProductAccess"]
  >[0]["requestBody"],
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new AccessService(request).restoreProductAccess({ requestBody }),
    200,
    { accessToken },
  );
}
