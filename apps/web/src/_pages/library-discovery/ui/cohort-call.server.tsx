import "server-only";
import { ProductWaitlistSlot } from "./waitlist-provider.client";
import { connection } from "next/server";

import { cohortCountdown, StartCountdownBadge } from "@/entities/subscription";
import { loadProductCohort } from "@/entities/subscription.catalog.server";
import {
  readGuestProductSale,
  readProductAccess,
  readViewerProductSale,
} from "@/entities/subscription.sale.server";
import {
  CohortCallView,
  CourseLearningLink,
  courseLearningAction,
  CohortStatusView,
  type CohortCall,
} from "@/features/ai-engineering-course";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { getSeriesContinuation } from "@/features/reading-progress.server";
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
  if (
    accessToken !== undefined &&
    (await readProductAccess(productId, accessToken)) === "open"
  ) {
    const progress = await getSeriesContinuation(slug, accessToken);
    return (
      <>
        <CohortCallView
          call={{
            banner: null,
            action: courseLearningAction(
              slug,
              progress.kind === "ready"
                ? (progress.continuation?.materialSlug ?? null)
                : null,
            ),
          }}
        />
      </>
    );
  }
  const sale = await (accessToken === undefined
    ? readGuestProductSale(productId)
    : readViewerProductSale(productId, accessToken));
  if (
    slug === "ai-engineering" &&
    sale.kind !== "unavailable" &&
    sale.offers.length === 0
  )
    return <ProductWaitlistSlot />;
  return (
    <>
      {sale.kind === "unavailable" || !sale.cohortKnown ? (
        <PendingCohortCall slug={slug} />
      ) : (
        <CohortCallView
          call={cohortCall({
            cohort: sale.cohort,
            offer: sale.offers[0] ?? null,
            productAccess: sale.access,
            signedIn: sale.signedIn,
            slug,
          })}
        />
      )}
      {slug === "ai-engineering" &&
      sale.kind !== "unavailable" &&
      sale.access !== "open" ? (
        <ProductWaitlistSlot existingOnly />
      ) : null}
    </>
  );
}

/**
 * Личная часть нижнего блока: участник продолжает обучение, остальные видят набор на поток.
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
  if (
    accessToken !== undefined &&
    (await readProductAccess(productId, accessToken)) === "open"
  )
    return <CourseLearningLink slug={slug} placement="status" />;
  const sale = await (accessToken === undefined
    ? readGuestProductSale(productId)
    : readViewerProductSale(productId, accessToken));
  if (
    slug === "ai-engineering" &&
    sale.kind !== "unavailable" &&
    sale.access !== "open" &&
    sale.offers.length === 0
  )
    return <ProductWaitlistSlot lower />;
  const status =
    sale.kind === "unavailable" || !sale.cohortKnown
      ? null
      : cohortStatus({
          cohort: sale.cohort,
          offer: sale.offers[0] ?? null,
          productAccess: sale.access,
          slug,
        });
  return (
    <>
      {status === null ? null : <CohortStatusView status={status} />}
      {slug === "ai-engineering" &&
      sale.kind !== "unavailable" &&
      sale.access !== "open" ? (
        <ProductWaitlistSlot existingOnly />
      ) : null}
    </>
  );
}

/**
 * На анимации остаётся наклейка до старта потока; участнику доступно действие обучения.
 */
export async function PersonalCourseFilmOverlay({
  result,
}: {
  readonly result: ResolvedSeries;
}) {
  await connection();
  const productId = result.reference.id;
  if (productId === undefined) return null;
  const accessToken = await getOptionalPlatformAccessToken();
  const learningAvailable =
    accessToken !== undefined &&
    (await readProductAccess(productId, accessToken)) === "open";
  const read = await loadProductCohort(productId);
  const countdown = read.kind === "ready" ? cohortCountdown(read.cohort) : null;
  return (
    <>
      {countdown === null ? null : <StartCountdownBadge text={countdown} />}
      {learningAvailable ? (
        <CourseLearningLink slug={result.reference.slug} placement="film" />
      ) : null}
    </>
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
