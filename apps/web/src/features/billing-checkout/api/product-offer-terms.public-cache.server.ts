import "server-only";

import { readGuestProductSale } from "@/entities/subscription.sale.server";
import type { OneTimeOfferTerms } from "@/entities/subscription.terms";
import { applyCatalogCachePolicy } from "@/shared/api/catalog-cache.server";

export type PublicProductOfferTerms =
  | { readonly kind: "ready"; readonly terms: OneTimeOfferTerms | null }
  | { readonly kind: "unavailable" };

/**
 * Сроки предложения продукта глазами гостя — для подстановок в его описании. В общий кеш попадают
 * только сроки самого дешёвого предложения для всех: ни цена, ни скидка, ни предложение с
 * ограничением допуска сюда не доходят (ADR 0027). `null` — продукт сейчас не продаётся.
 */
export async function readPublicProductOfferTerms(
  productId: string,
): Promise<PublicProductOfferTerms> {
  "use cache";
  const result = await readGuestOfferTerms(productId);
  applyCatalogCachePolicy(result.kind);
  return result;
}

async function readGuestOfferTerms(
  productId: string,
): Promise<PublicProductOfferTerms> {
  const sale = await readGuestProductSale(productId);
  return sale.kind === "unavailable"
    ? sale
    : { kind: "ready", terms: sale.terms };
}
