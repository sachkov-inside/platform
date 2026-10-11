import "server-only";
import { z } from "zod";
import { requestProductAccess } from "@/shared/api/backend/index.server";
import { loadProductCohort, loadProductOffers } from "./billing-catalog.server";
import {
  oneTimeOfferTerms,
  type OneTimeOfferTerms,
} from "../model/offer-terms";
import type { ProductCohort, PriceSnapshot } from "../model/billing-contract";

export type ProductSale =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "ready";
      readonly sold: boolean;
      readonly offers: readonly PriceSnapshot[];
      readonly cohort: ProductCohort | null;
      readonly cohortKnown: boolean;
      readonly access: "open" | "closed" | "unknown";
      readonly signedIn: boolean;
      readonly terms: OneTimeOfferTerms | null;
    };
const accessSchema = z.object({ access: z.enum(["open", "closed"]) });

/** Гостевой вход не читает сессию. Полное состояние продажи никогда не помещается в общий кеш. */
export function readGuestProductSale(productId: string): Promise<ProductSale> {
  return readProductSale(productId);
}

/** Личный вход требует явный токен читателя; страница получает его после connection(). */
export function readViewerProductSale(
  productId: string,
  accessToken: string,
): Promise<ProductSale> {
  return readProductSale(productId, accessToken);
}

async function readProductSale(
  productId: string,
  accessToken?: string,
): Promise<ProductSale> {
  const [catalog, cohort, access] = await Promise.all([
    loadProductOffers(productId, accessToken),
    loadProductCohort(productId),
    accessToken === undefined
      ? ("closed" as const)
      : readProductAccess(productId, accessToken),
  ]);
  if (catalog.kind === "unavailable") return catalog;
  // Backend решает, что продаётся. Web задаёт лишь стабильный порядок показа цены.
  const offers = [...catalog.offers].sort((left, right) =>
    left.firstPriceKopecks !== right.firstPriceKopecks
      ? left.firstPriceKopecks - right.firstPriceKopecks
      : left.paymentOption.id.localeCompare(right.paymentOption.id),
  );
  return {
    kind: "ready",
    sold: offers.length > 0,
    offers,
    cohort: cohort.kind === "ready" ? cohort.cohort : null,
    cohortKnown: cohort.kind === "ready",
    access,
    signedIn: accessToken !== undefined,
    terms: offers[0] === undefined ? null : oneTimeOfferTerms(offers[0]),
  };
}
/** Доступ участника не зависит от того, открыта ли сейчас продажа продукта. */
export async function readProductAccess(
  productId: string,
  accessToken: string,
): Promise<"open" | "closed" | "unknown"> {
  try {
    const result = await requestProductAccess(productId, accessToken);
    if (!result.ok) return "unknown";
    const parsed = accessSchema.safeParse(result.body);
    return parsed.success ? parsed.data.access : "unknown";
  } catch {
    return "unknown";
  }
}
