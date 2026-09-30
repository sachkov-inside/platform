import "server-only";
import { connection } from "next/server";

import {
  loadGuideCohort,
  loadGuideOffers,
} from "@/entities/subscription.server";
import {
  CohortCallView,
  type CohortCall,
} from "@/features/ai-engineering-course";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

import { cohortCall, productOwnership } from "../model/cohort-call";

type ResolvedSeries = Extract<
  PublishedSeriesResult,
  { readonly kind: "ready" | "empty" }
>;

/** Запасной вид личной части: та же кнопка в программу, что и у страницы без потока. */
export function PendingCohortCall({ slug }: { readonly slug: string }) {
  return <CohortCallView call={withoutCohort(slug)} />;
}

/**
 * Личная часть первого экрана курса: поток из каталога, предложение, которое видит этот человек,
 * и открыт ли ему продукт. Ничего из этого не кешируется: этап и цена меняются без выпуска, а
 * предложение зависит от допуска читателя (ADR 0027).
 */
export async function PersonalCohortCall({
  result,
}: {
  readonly result: ResolvedSeries;
}) {
  await connection();
  const { id: guideId, slug } = result.reference;
  if (guideId === undefined) return <PendingCohortCall slug={slug} />;
  const accessToken = await getOptionalPlatformAccessToken();
  const [cohort, offers, personal] = await Promise.all([
    loadGuideCohort(guideId),
    loadGuideOffers(guideId),
    accessToken === undefined ? result : loadPublishedSeries(slug, accessToken),
  ]);
  // Без потока страница остаётся прежней: сбой чтения каталога не выдумывает этап.
  if (cohort.kind === "unavailable") return <PendingCohortCall slug={slug} />;
  return (
    <CohortCallView
      call={cohortCall({
        cohort: cohort.cohort,
        offer: offers.kind === "ready" ? (offers.offers[0] ?? null) : null,
        ownership:
          personal.kind === "ready"
            ? productOwnership(personal.items)
            : "unknown",
        signedIn: accessToken !== undefined,
        slug,
      })}
    />
  );
}

function withoutCohort(slug: string): CohortCall {
  return cohortCall({
    cohort: null,
    offer: null,
    ownership: "unknown",
    signedIn: false,
    slug,
  });
}
