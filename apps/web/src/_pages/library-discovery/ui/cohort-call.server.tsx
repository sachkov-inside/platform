import "server-only";
import { Suspense } from "react";
import type { ProductSale } from "@/entities/subscription.sale.server";
import { ProductWaitlistSlot } from "./waitlist-provider.client";

import { cohortCountdown, StartCountdownBadge } from "@/entities/subscription";
import { readProductReaderState } from "@/widgets/product-reader-state/index.server";
import {
  CohortCallView,
  CourseLearningLink,
  courseLearningAction,
  CohortStatusView,
  programmeCallLabel,
  type CohortCall,
} from "@/features/ai-engineering-course";
import type { PublishedProductResult } from "@/features/library-discovery";

import { cohortCall } from "../model/cohort-call";
import { cohortStatus } from "../model/cohort-status";
import { countFreeLessons } from "../model/free-lessons";
import { LearnerCourseStatus } from "./ai-engineering-course-view";

type ResolvedProduct = Extract<
  PublishedProductResult,
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
  readonly result: ResolvedProduct;
}) {
  const { id: productId, slug } = result.reference;
  if (productId === undefined) return <PendingCohortCall slug={slug} />;
  const state = await readProductReaderState(productId, slug);
  if (state.kind === "learning")
    return (
      <CohortCallView
        call={{
          banner: null,
          action: courseLearningAction(
            slug,
            state.continuation.kind === "ready"
              ? (state.continuation.continuation?.materialSlug ?? null)
              : null,
          ),
        }}
      />
    );
  if (state.kind === "waitlist") return <ProductWaitlistSlot />;
  const sale = state.sale;
  return (
    <>
      {state.kind === "checking" ||
      state.kind === "unavailable" ||
      sale.kind === "unavailable" ||
      !sale.cohortKnown ? (
        <PendingCohortCall slug={slug} />
      ) : (
        <CohortCallView
          call={cohortCall({
            cohort: sale.cohort,
            offer: sale.offers[0] ?? null,
            productAccess: state.access,
            signedIn: state.signedIn,
            slug,
          })}
        />
      )}
      {state.waitlist.kind === "ready" ? (
        <ProductWaitlistSlot existingOnly />
      ) : null}
    </>
  );
}

/** Every slot displays the same request-scoped reader projection. */
export async function PersonalCohortStatus({
  result,
}: {
  readonly result: ResolvedProduct;
}) {
  const { id: productId, slug } = result.reference;
  if (productId === undefined) return null;
  const state = await readProductReaderState(productId, slug);
  if (state.kind === "learning") return <LearnerCourseStatus />;
  const freeStart = hasFreeLessons(result);
  if (state.kind === "waitlist")
    return (
      <ProductWaitlistSlot
        lower
        programmeLabel={programmeCallLabel(freeStart)}
      />
    );
  const sale = state.sale;
  const status =
    state.kind === "checking" ||
    state.kind === "unavailable" ||
    sale.kind === "unavailable" ||
    !sale.cohortKnown
      ? null
      : cohortStatus({
          cohort: sale.cohort,
          offer: sale.offers[0] ?? null,
          productAccess: state.access,
          slug,
          freeStart,
        });
  return (
    <>
      {status === null ? null : <CohortStatusView status={status} />}
      {state.waitlist.kind === "ready" ? (
        <ProductWaitlistSlot existingOnly />
      ) : null}
    </>
  );
}

export async function PersonalCourseFilmOverlay({
  result,
}: {
  readonly result: ResolvedProduct;
}) {
  const { id: productId, slug } = result.reference;
  if (productId === undefined) return null;
  const state = await readProductReaderState(productId, slug);
  return (
    <>
      {state.kind === "learning" ? (
        <>
          <CourseLearningLink slug={slug} />
          <Suspense fallback={null}>
            <OptionalLearningCountdown presentation={state.presentation} />
          </Suspense>
        </>
      ) : (
        <>
          {/* Тому, кто ещё не учится, анимация зовёт попробовать бесплатно (#1647). */}
          {state.access === "closed" && hasFreeLessons(result) ? (
            <CourseLearningLink intent="try-free" slug={slug} />
          ) : null}
          <SaleCountdown sale={state.sale} />
        </>
      )}
    </>
  );
}

async function OptionalLearningCountdown({
  presentation,
}: {
  readonly presentation: Extract<
    Awaited<ReturnType<typeof readProductReaderState>>,
    { kind: "learning" }
  >["presentation"];
}) {
  return <SaleCountdown sale={(await presentation).sale} />;
}
function SaleCountdown({ sale }: { readonly sale: ProductSale }) {
  const countdown =
    sale.kind === "ready" && sale.cohortKnown
      ? cohortCountdown(sale.cohort)
      : null;
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

/** Есть ли в курсе бесплатные уроки: от этого зависят приглашения начать бесплатно (#1647). */
function hasFreeLessons(result: ResolvedProduct): boolean {
  return result.kind === "ready" && countFreeLessons(result.items) > 0;
}
