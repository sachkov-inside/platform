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
import { loadGuideAccess } from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

import { cohortCall } from "../model/cohort-call";

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
  const [cohort, offers, access] = await Promise.all([
    loadGuideCohort(guideId),
    loadGuideOffers(guideId),
    // Гостю продукт не открыт: оплата ведёт через вход.
    accessToken === undefined
      ? ("closed" as const)
      : loadGuideAccess(guideId, accessToken),
  ]);
  // Без потока страница остаётся прежней: сбой чтения каталога не выдумывает этап.
  if (cohort.kind === "unavailable") return <PendingCohortCall slug={slug} />;
  return (
    <CohortCallView
      call={cohortCall({
        cohort: cohort.cohort,
        offer: offers.kind === "ready" ? (offers.offers[0] ?? null) : null,
        access,
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
    access: "unknown",
    signedIn: false,
    slug,
  });
}
