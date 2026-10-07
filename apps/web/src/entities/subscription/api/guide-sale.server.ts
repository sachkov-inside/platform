import "server-only";
import { z } from "zod";
import { requestGuideAccess } from "@/shared/api/backend/index.server";
import { loadGuideCohort, loadGuideOffers } from "./billing-catalog.server";
import {
  oneTimeOfferTerms,
  type OneTimeOfferTerms,
} from "../model/offer-terms";
import type { GuideCohort, PriceSnapshot } from "../model/billing-contract";

export type GuideSale =
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "ready";
      readonly sold: boolean;
      readonly offers: readonly PriceSnapshot[];
      readonly cohort: GuideCohort | null;
      readonly cohortKnown: boolean;
      readonly access: "open" | "closed" | "unknown";
      readonly signedIn: boolean;
      readonly terms: OneTimeOfferTerms | null;
    };
const accessSchema = z.object({ access: z.enum(["open", "closed"]) });

/** Гостевой вход не читает сессию. Полное состояние продажи никогда не помещается в общий кеш. */
export function readGuestGuideSale(guideId: string): Promise<GuideSale> {
  return readGuideSale(guideId);
}

/** Личный вход требует явный токен читателя; страница получает его после connection(). */
export function readViewerGuideSale(
  guideId: string,
  accessToken: string,
): Promise<GuideSale> {
  return readGuideSale(guideId, accessToken);
}

async function readGuideSale(
  guideId: string,
  accessToken?: string,
): Promise<GuideSale> {
  const [catalog, cohort, access] = await Promise.all([
    loadGuideOffers(guideId, accessToken),
    loadGuideCohort(guideId),
    accessToken === undefined
      ? ("closed" as const)
      : readAccess(guideId, accessToken),
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
async function readAccess(
  guideId: string,
  accessToken: string,
): Promise<"open" | "closed" | "unknown"> {
  try {
    const result = await requestGuideAccess(guideId, accessToken);
    if (!result.ok) return "unknown";
    const parsed = accessSchema.safeParse(result.body);
    return parsed.success ? parsed.data.access : "unknown";
  } catch {
    return "unknown";
  }
}
