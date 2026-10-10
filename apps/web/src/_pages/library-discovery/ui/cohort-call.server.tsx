import "server-only";
import { connection } from "next/server";

import { cohortCountdown, StartCountdownBadge } from "@/entities/subscription";
import { loadProductCohort } from "@/entities/subscription.catalog.server";
import {
  readGuestProductSale,
  readViewerProductSale,
} from "@/entities/subscription.sale.server";
import {
  CohortCallView,
  CohortStatusView,
  type CohortCall,
} from "@/features/ai-engineering-course";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

import { cohortCall } from "../model/cohort-call";
import { cohortStatus } from "../model/cohort-status";

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

/**
 * Личная часть нижнего блока: плашка набора на поток, пока он не стартовал. Без набора блок
 * остаётся со своим текстом из описания курса, поэтому здесь тогда ничего не рисуется.
 */
export async function PersonalCohortStatus({
  result,
}: {
  readonly result: ResolvedSeries;
}) {
  await connection();
  const { id: productId, slug } = result.reference;
  if (productId === undefined) return null;
  const accessToken = await getOptionalPlatformAccessToken();
  const sale = await (accessToken === undefined
    ? readGuestProductSale(productId)
    : readViewerProductSale(productId, accessToken));
  if (sale.kind === "unavailable" || !sale.cohortKnown) return null;
  const status = cohortStatus({
    cohort: sale.cohort,
    offer: sale.offers[0] ?? null,
    productAccess: sale.access,
    slug,
  });
  return status === null ? null : <CohortStatusView status={status} />;
}

/**
 * Наклейка «до старта N дней» на анимации первого экрана. Ей нужен только поток — он публичный и
 * одинаков для всех, поэтому чтение не спрашивает ни цену, ни доступ человека.
 */
export async function PersonalCohortCountdown({
  result,
}: {
  readonly result: ResolvedSeries;
}) {
  await connection();
  const productId = result.reference.id;
  if (productId === undefined) return null;
  const read = await loadProductCohort(productId);
  const countdown = read.kind === "ready" ? cohortCountdown(read.cohort) : null;
  return countdown === null ? null : <StartCountdownBadge text={countdown} />;
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
