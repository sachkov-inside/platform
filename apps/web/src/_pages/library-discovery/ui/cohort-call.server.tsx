import "server-only";
import { connection } from "next/server";

import {
  readGuestProductSale,
  readViewerProductSale,
} from "@/entities/subscription.sale.server";
import {
  CohortCallView,
  type CohortCall,
} from "@/features/ai-engineering-course";
import type { PublishedSeriesResult } from "@/features/library-discovery";
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
  const { id: productId, slug } = result.reference;
  if (productId === undefined) return <PendingCohortCall slug={slug} />;
  const accessToken = await getOptionalPlatformAccessToken();
  const sale = await (accessToken === undefined
    ? readGuestProductSale(productId)
    : readViewerProductSale(productId, accessToken));
  if (sale.kind === "unavailable" || !sale.cohortKnown)
    return <PendingCohortCall slug={slug} />;
  return (
    <CohortCallView
      call={cohortCall({
        cohort: sale.cohort,
        offer: sale.offers[0] ?? null,
        productAccess: sale.access,
        signedIn: sale.signedIn,
        slug,
      })}
    />
  );
}

function withoutCohort(slug: string): CohortCall {
  return cohortCall({
    cohort: null,
    offer: null,
    productAccess: "unknown",
    signedIn: false,
    slug,
  });
}
