import "server-only";
import { Suspense } from "react";
import type { ProductSale } from "@/entities/subscription.sale.server";
import { ProductWaitlistSlot } from "./waitlist-provider.client";

import {
  cohortCountdown,
  saleDiscount,
  StartCountdownBadge,
} from "@/entities/subscription";
import { readProductReaderState } from "@/widgets/product-reader-state/index.server";
import {
  CohortCallView,
  CourseLearningLink,
  courseLearningAction,
  CohortStatusView,
  CourseDiscountStrip,
  programmeCallLabel,
  type CohortCall,
} from "@/features/ai-engineering-course";
import type {
  ProductAccess,
  PublishedProductResult,
} from "@/features/library-discovery";

import { cohortCall, cohortEnrollAnchor } from "../model/cohort-call";
import { cohortStatus } from "../model/cohort-status";
import { courseTelegramHandle } from "../model/course-contact";
import { countFreeLessons, hasFreeFirstLesson } from "../model/free-lessons";
import { LearnerCourseStatus } from "./ai-engineering-course-view";
import { TicketContact } from "./telegram-contact";

type ResolvedProduct = Extract<
  PublishedProductResult,
  { readonly kind: "ready" | "empty" }
>;

/** Запасной вид личной части: первый экран без потока, без кнопки и плашки. */
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
            freeStart: offersFreeStart(state.access, result),
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
  const status = sellingStatus(state, result);
  // Ник автора из подписи частых вопросов: на него ведут консультация и оплата не из России.
  const handle = courseTelegramHandle(
    result.reference.productPage?.page ?? null,
  );
  return (
    <>
      {status === null ? null : (
        <CohortStatusView
          // Консультация стоит под ценой; в билете анонса цены ещё нет.
          contact={
            status.price === null || handle === undefined ? null : (
              <TicketContact handle={handle} />
            )
          }
          status={status}
          telegramHandle={handle}
        />
      )}
      {state.waitlist.kind === "ready" ? (
        <ProductWaitlistSlot existingOnly />
      ) : null}
    </>
  );
}

/** Билет нижнего блока для того, кому курс не открыт; `null`, пока этап или цена неизвестны. */
function sellingStatus(
  state: Exclude<
    Awaited<ReturnType<typeof readProductReaderState>>,
    { readonly kind: "learning" | "waitlist" }
  >,
  result: ResolvedProduct,
) {
  const sale = state.sale;
  if (
    state.kind === "checking" ||
    state.kind === "unavailable" ||
    sale.kind === "unavailable" ||
    !sale.cohortKnown
  )
    return null;
  return cohortStatus({
    cohort: sale.cohort,
    offer: sale.offers[0] ?? null,
    productAccess: state.access,
    slug: result.reference.slug,
    freeStart: hasFreeLessons(result),
  });
}

/**
 * Полоса действующей скидки над шапкой страницы курса. Она ведёт к цене в билете, поэтому
 * стоит, только пока билет предлагает купить (решение владельца 23.11.2026).
 */
export async function PersonalCourseDiscount({
  result,
}: {
  readonly result: ResolvedProduct;
}) {
  const { id: productId, slug } = result.reference;
  if (productId === undefined) return null;
  const state = await readProductReaderState(productId, slug);
  if (state.kind === "learning" || state.kind === "waitlist") return null;
  const status = sellingStatus(state, result);
  if (status?.purchaseHref == null || state.sale.kind !== "ready") return null;
  const discount = saleDiscount(state.sale.offers[0] ?? null);
  return discount === null ? null : (
    <CourseDiscountStrip discount={discount} href={`#${cohortEnrollAnchor}`} />
  );
}

export async function PersonalCourseFilmOverlay({
  result,
}: {
  readonly result: ResolvedProduct;
}) {
  const { id: productId, slug } = result.reference;
  if (productId === undefined)
    return <CourseLearningLink slug={slug} intent="programme" />;
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
          {offersFreeStart(state.access, result) ? (
            <FreeStartLink slug={slug} result={result} />
          ) : (
            <CourseLearningLink slug={slug} intent="programme" />
          )}
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

/** Бесплатный старт на анимации: обе подписи ведут в программу. */
function FreeStartLink({
  slug,
  result,
}: {
  readonly slug: string;
  readonly result: ResolvedProduct;
}) {
  const firstIsFree =
    result.kind === "ready" &&
    hasFreeFirstLesson(result.items, result.programmePlacements);
  return (
    <CourseLearningLink
      intent={firstIsFree ? "start-free" : "try-free"}
      slug={slug}
    />
  );
}

/**
 * Зовёт ли курс этого человека попробовать бесплатно: тогда на анимации стоит «Начать бесплатно»
 * или «Попробовать бесплатно», оба ведут в программу, а первый экран не повторяет кнопку в
 * программу (#1647). Читатель без подтверждённого доступа к курсу или бесплатному старту может посмотреть программу.
 */
function offersFreeStart(
  access: ProductAccess,
  result: ResolvedProduct,
): boolean {
  return access === "closed" && hasFreeLessons(result);
}
