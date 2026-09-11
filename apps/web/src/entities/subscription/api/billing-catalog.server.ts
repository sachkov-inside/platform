import "server-only";

import { requestBillingOffers } from "@/shared/api/backend/index.server";

import {
  guideCapability,
  guidePurchaseOffer,
  offersPageSchema,
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

/** Каталог рендерится сервером: цены и состав приходят из billing, а не из разметки страницы. */
export async function loadBillingOffers(
  query: CatalogQuery = {},
): Promise<OffersResult> {
  const offers: PriceSnapshot[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < catalogPageBudget; page += 1) {
      const result = await requestBillingOffers({
        ...query,
        limit: catalogPageSize,
        ...(cursor === undefined ? {} : { cursor }),
      });
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
 * Разовое предложение одного руководства. Отсутствие предложения — обычное состояние:
 * руководство продаётся, только когда владелец завёл ему цену.
 */
export async function loadGuideOffer(
  guideId: string,
): Promise<
  | { readonly kind: "ready"; readonly offer: PriceSnapshot | null }
  | { readonly kind: "unavailable" }
> {
  const result = await loadBillingOffers({
    mode: "one_time",
    capability: guideCapability(guideId),
  });
  return result.kind === "unavailable"
    ? result
    : { kind: "ready", offer: guidePurchaseOffer(result.offers, guideId) };
}
