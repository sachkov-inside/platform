import "server-only";

import {
  guideCapability,
  guidePurchaseOffers,
  offersPageSchema,
} from "@/entities/subscription";
import { requestBillingOffers } from "@/shared/api/backend/index.server";
import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

import {
  oneTimeOfferTerms,
  type OneTimeOfferTerms,
} from "../model/one-time-terms";

export type PublicGuideOfferTerms =
  | { readonly kind: "ready"; readonly terms: OneTimeOfferTerms | null }
  | { readonly kind: "unavailable" };

/** Предложений одного продукта единицы: первой страницы каталога хватает с запасом. */
const guideOffersLimit = 50;

/**
 * Сроки предложения продукта глазами гостя — для подстановок в его описании. В общий кеш попадают
 * только сроки самого дешёвого предложения для всех: ни цена, ни скидка, ни предложение с
 * ограничением допуска сюда не доходят (ADR 0027). `null` — продукт сейчас не продаётся.
 */
export async function readPublicGuideOfferTerms(
  guideId: string,
): Promise<PublicGuideOfferTerms> {
  "use cache";
  const result = await readGuestOfferTerms(guideId);
  applyCatalogCachePolicy(result.kind);
  return result;
}

async function readGuestOfferTerms(
  guideId: string,
): Promise<PublicGuideOfferTerms> {
  try {
    const result = await requestBillingOffers({
      capability: guideCapability(guideId),
      limit: guideOffersLimit,
    });
    if (!result.ok) return { kind: "unavailable" };
    const parsed = offersPageSchema.safeParse(result.body);
    if (!parsed.success) return { kind: "unavailable" };
    const [offer] = guidePurchaseOffers(parsed.data.items, guideId);
    return {
      kind: "ready",
      terms: offer === undefined ? null : oneTimeOfferTerms(offer),
    };
  } catch {
    return { kind: "unavailable" };
  }
}
