import "server-only";

import { requestBillingOffers } from "@/shared/api/backend/index.server";

import { offersPageSchema, type PriceSnapshot } from "../model/billing-contract";

export type OffersResult =
  | { readonly kind: "ready"; readonly offers: readonly PriceSnapshot[] }
  | { readonly kind: "unavailable" };

const catalogPageSize = 50;
/** Каталог подписки мал, но страница не обрывает его молча: курсор дочитывается до конца. */
const catalogPageBudget = 5;

/** Каталог рендерится сервером: цены и состав приходят из billing, а не из разметки страницы. */
export async function loadBillingOffers(): Promise<OffersResult> {
  const offers: PriceSnapshot[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < catalogPageBudget; page += 1) {
      const result = await requestBillingOffers({
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
