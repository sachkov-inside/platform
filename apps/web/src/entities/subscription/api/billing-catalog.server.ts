import "server-only";

import {
  requestBillingOffers,
  requestGuideCohorts,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

import {
  guideCapability,
  guideCohortsSchema,
  guidePurchaseOffers,
  offersPageSchema,
  type GuideCohort,
  type PaymentMode,
  type PriceSnapshot,
} from "../model/billing-contract";

export type OffersResult =
  | { readonly kind: "ready"; readonly offers: readonly PriceSnapshot[] }
  | { readonly kind: "unavailable" };

const catalogPageSize = 50;
/** Каталог подписки мал, но страница не обрывает его молча: курсор дочитывается до конца. */
const catalogPageBudget = 5;

/** Чего именно спрашивает страница: витрина подписки и витрина руководства разные. */
export interface CatalogQuery {
  readonly mode?: PaymentMode;
  readonly capability?: string;
}

/**
 * Каталог рендерится сервером: цены и состав приходят из billing, а не из разметки страницы.
 * Каталог читается от имени покупателя, если он вошёл: Offer с ограничением допуска виден только
 * допущенному Account. Гость видит Offer для всех.
 */
export async function loadBillingOffers(
  query: CatalogQuery = {},
): Promise<OffersResult> {
  const offers: PriceSnapshot[] = [];
  let cursor: string | undefined;
  // Отсутствие сессии — гость; сбой чтения сессии, как и в остальной личной части страницы, не
  // выдаётся за гостевую витрину.
  const accessToken = await getOptionalPlatformAccessToken();
  try {
    for (let page = 0; page < catalogPageBudget; page += 1) {
      const result = await requestBillingOffers(
        {
          ...query,
          limit: catalogPageSize,
          ...(cursor === undefined ? {} : { cursor }),
        },
        accessToken,
      );
      if (!result.ok) return { kind: "unavailable" };
      const parsed = offersPageSchema.safeParse(result.body);
      if (!parsed.success) return { kind: "unavailable" };
      offers.push(...parsed.data.items);
      if (parsed.data.nextCursor === null) return { kind: "ready", offers };
      cursor = parsed.data.nextCursor;
    }
    return { kind: "ready", offers };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Предложения одного руководства. Отсутствие предложений — обычное состояние: руководство
 * продаётся, только когда владелец завёл ему цену. Их может быть несколько, поэтому страница
 * оплаты умеет показать выбор. Чем именно торгуют, решает `guidePurchaseOffers`: запрос сужен
 * только по праву, чтобы отбор жил в одном месте.
 */
export async function loadGuideOffers(
  guideId: string,
): Promise<
  | { readonly kind: "ready"; readonly offers: readonly PriceSnapshot[] }
  | { readonly kind: "unavailable" }
> {
  const result = await loadBillingOffers({
    capability: guideCapability(guideId),
  });
  return result.kind === "unavailable"
    ? result
    : { kind: "ready", offers: guidePurchaseOffers(result.offers, guideId) };
}

/**
 * Текущие потоки продуктов. Поток не кешируется, как и цены: владелец переключает этап в
 * каталоге, и страница показывает его со следующего запроса.
 */
export async function loadGuideCohorts(): Promise<
  | { readonly kind: "ready"; readonly cohorts: readonly GuideCohort[] }
  | { readonly kind: "unavailable" }
> {
  try {
    const result = await requestGuideCohorts();
    if (!result.ok) return { kind: "unavailable" };
    const parsed = guideCohortsSchema.safeParse(result.body);
    return parsed.success
      ? { kind: "ready", cohorts: parsed.data.items }
      : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** Поток одного продукта. Продукт без потока — обычное состояние: страница зовёт в программу. */
export async function loadGuideCohort(
  guideId: string,
): Promise<
  | { readonly kind: "ready"; readonly cohort: GuideCohort | null }
  | { readonly kind: "unavailable" }
> {
  const result = await loadGuideCohorts();
  return result.kind === "unavailable"
    ? result
    : {
        kind: "ready",
        cohort: result.cohorts.find((item) => item.guideId === guideId) ?? null,
      };
}
