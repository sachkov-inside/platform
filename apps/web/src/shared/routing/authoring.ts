import type { Route } from "next";
import { z } from "zod";

import { internalRoute } from "./internal-route";

export const authoringMaterialsRootHref = internalRoute("/authoring/materials");

/** Обзор (#1719): стартовая страница админки, куда ведет бренд каркаса. */
export const authoringOverviewHref = "/authoring" satisfies Route;

const authoringProductsPrefix = "/authoring/products/";
const productIdSchema = z.uuid();

/**
 * Вкладки страницы продукта в адресе `?tab=`. Первая, «Обзор» (#1719), открывается без параметра.
 * Страница продукта (`_pages/content-collections`) берёт список отсюда, поэтому адрес вкладки
 * строит одно место.
 */
export const authoringProductTabIds = [
  "overview",
  "program",
  "description",
  "sale",
  "learners",
  "community",
] as const;

export type AuthoringProductTab = (typeof authoringProductTabIds)[number];

/** Страница продукта на вкладке `tab`; «Обзор» без параметра. */
export function authoringProductEditorHref(
  productId: string,
  tab: AuthoringProductTab = authoringProductTabIds[0],
): Route {
  const path = `${authoringProductsPrefix}${productId}`;
  return internalRoute(
    tab === authoringProductTabIds[0] ? path : `${path}?tab=${tab}`,
  );
}

/** «Сдачи»: список открывается с фильтром «без комментария». */
export const authoringSubmissionsHref =
  "/authoring/submissions" satisfies Route;

/** Сдача, открытая поверх списка «Сдачи». */
export function authoringSubmissionHref(submissionId: string): Route {
  return internalRoute(
    `${authoringSubmissionsHref}?${new URLSearchParams({ submission: submissionId }).toString()}`,
  );
}

/** «Воронка продаж» (#1718). */
export const authoringSalesFunnelHref =
  "/authoring/sales/funnel" satisfies Route;

/** Готовые периоды отчёта воронки в днях, считая сегодняшний день по Москве. */
export const salesFunnelPeriodPresets = [7, 30, 90] as const;
export type SalesFunnelPeriodPreset = (typeof salesFunnelPeriodPresets)[number];
/** Тридцать дней идут по умолчанию и в адрес не пишутся. */
export const defaultSalesFunnelPeriodPreset: SalesFunnelPeriodPreset = 30;

export type SalesFunnelPeriod =
  | { readonly kind: "preset"; readonly days: SalesFunnelPeriodPreset }
  /** Даты по Москве включительно, `YYYY-MM-DD`. */
  | { readonly kind: "custom"; readonly from: string; readonly to: string };

/**
 * Адрес отчёта воронки: продукт, глава и период. `null` у продукта и главы значит выбор сервера
 * (первый продукт и его первая глава). Здесь единственный кодировщик этого адреса: им пользуются
 * страница отчёта и ссылки на неё из других разделов.
 */
export interface SalesFunnelAddress {
  readonly productId: string | null;
  readonly chapterId: string | null;
  readonly period: SalesFunnelPeriod;
}

/** Имена параметров адреса отчёта воронки. */
export const salesFunnelParams = {
  productId: "productId",
  chapterId: "chapterId",
  period: "period",
  from: "from",
  to: "to",
} as const;

export function serializeSalesFunnelAddress(
  address: SalesFunnelAddress,
): string {
  const params = new URLSearchParams();
  if (address.productId !== null)
    params.set(salesFunnelParams.productId, address.productId);
  if (address.productId !== null && address.chapterId !== null)
    params.set(salesFunnelParams.chapterId, address.chapterId);
  if (address.period.kind === "custom") {
    params.set(salesFunnelParams.from, address.period.from);
    params.set(salesFunnelParams.to, address.period.to);
  } else if (address.period.days !== defaultSalesFunnelPeriodPreset)
    params.set(salesFunnelParams.period, String(address.period.days));
  return params.toString();
}

export function authoringSalesFunnelAddressHref(
  address: SalesFunnelAddress,
): Route {
  const serialized = serializeSalesFunnelAddress(address);
  return serialized === ""
    ? authoringSalesFunnelHref
    : internalRoute(`${authoringSalesFunnelHref}?${serialized}`);
}

/** Отчёт воронки по продукту за готовый период, первая глава продукта. */
export function authoringSalesFunnelProductHref(
  productId: string,
  periodDays: SalesFunnelPeriodPreset,
): Route {
  return authoringSalesFunnelAddressHref({
    productId,
    chapterId: null,
    period: { kind: "preset", days: periodDays },
  });
}

/** «Платежи» раздела «Продажи» (#1718). */
export const authoringPaymentsHref =
  "/authoring/sales/payments" satisfies Route;

/** Страница одного платежа. */
export function authoringPaymentHref(purchaseRef: string): Route {
  return internalRoute(`${authoringPaymentsHref}/${purchaseRef}`);
}

/** Список людей админки (#1721); прежний `/authoring/access` перенаправляется сюда. */
export const authoringPeopleHref = internalRoute("/authoring/people");

/**
 * Проблемы Telegram, которыми список людей открывается из Обзора (#1719), как их принимает
 * фильтр `?telegram=`. Схема фильтра списка людей строится из этого списка.
 */
export const authoringPeopleTelegramProblems = [
  "community_failed",
  "delivery_failed",
] as const;
export type AuthoringPeopleTelegramProblem =
  (typeof authoringPeopleTelegramProblems)[number];

/** Список людей с этой проблемой Telegram (`?telegram=`). */
export function authoringPeopleTelegramHref(
  problem: AuthoringPeopleTelegramProblem,
): Route {
  return internalRoute(`${authoringPeopleHref}?telegram=${problem}`);
}

/** Карточка человека по ID аккаунта. */
export function authoringPersonHref(accountId: string): Route {
  return internalRoute(`/authoring/people/${accountId}`);
}

/**
 * Возврат из редактора и предпросмотра материала: список материалов со своим поиском или
 * редактор продукта, из которого автор открыл материал (#837). Всё остальное — корень списка.
 */
export function parseAuthoringReturnHref(value: unknown): Route {
  if (typeof value !== "string" || value.length > 512) {
    return authoringMaterialsRootHref;
  }
  let url: URL;
  try {
    url = new URL(value, "https://inside.local");
  } catch {
    return authoringMaterialsRootHref;
  }
  if (url.origin !== "https://inside.local") {
    return authoringMaterialsRootHref;
  }
  const productId = returnProductId(url.pathname);
  if (productId !== undefined) {
    // Возврат на страницу продукта несёт только вкладку, например «Программу» (#1719).
    if (url.search === "") return internalRoute(url.pathname);
    const tab = authoringProductTabIds.find(
      (id) => id === url.searchParams.get("tab"),
    );
    return tab !== undefined && [...url.searchParams.keys()].length === 1
      ? authoringProductEditorHref(productId, tab)
      : authoringMaterialsRootHref;
  }
  if (url.pathname !== authoringMaterialsRootHref) {
    return authoringMaterialsRootHref;
  }
  const allowedKeys = new Set(["format", "page", "search", "state", "topic"]);
  if ([...url.searchParams.keys()].some((key) => !allowedKeys.has(key))) {
    return authoringMaterialsRootHref;
  }
  return internalRoute(`${url.pathname}${url.search}`);
}

/** Подпись ссылки по адресу возврата, который уже прошёл `parseAuthoringReturnHref`. */
export function authoringReturnLabel(returnHref: Route): string {
  return returnProductId(returnHref) === undefined
    ? "К материалам"
    : "К продукту";
}

/** Подпись кнопки возврата по адресу, который уже прошёл `parseAuthoringReturnHref`. */
export function authoringReturnActionLabel(returnHref: string): string {
  return returnProductId(returnHref) === undefined
    ? "Вернуться к материалам"
    : "Вернуться к продукту";
}

/**
 * Продукт, в редактор которого ведёт адрес возврата; у списка материалов продукта нет. Вкладка
 * в строке запроса продукта не меняет.
 */
function returnProductId(href: string): string | undefined {
  const pathname = href.split("?")[0] ?? href;
  if (!pathname.startsWith(authoringProductsPrefix)) return undefined;
  const parsed = productIdSchema.safeParse(
    pathname.slice(authoringProductsPrefix.length),
  );
  return parsed.success ? parsed.data : undefined;
}

export function withAuthoringReturnHref(
  pathname: string,
  returnHref: Route,
): Route {
  return internalRoute(
    `${pathname}?${new URLSearchParams({ from: returnHref }).toString()}`,
  );
}

/**
 * Предпросмотр материала. `productId` выбирает руководство, по маршруту которого автор листает
 * черновики. Без него руководство берётся из адреса возврата в редактор продукта, а без такого
 * адреса предпросмотр берёт первое руководство материала. Другой продукт, выбранный в самом
 * предпросмотре, адрес возврата не меняет: следующий предпросмотр из редактора материала
 * снова откроет продукт, из редактора которого пришёл автор.
 */
export function authoringMaterialPreviewHref(
  materialId: string,
  returnHref: Route,
  productId: string | undefined = returnProductId(returnHref),
): Route {
  return internalRoute(
    `/authoring/materials/${materialId}/preview?${new URLSearchParams({
      from: returnHref,
      ...(productId === undefined ? {} : { product: productId }),
    }).toString()}`,
  );
}
