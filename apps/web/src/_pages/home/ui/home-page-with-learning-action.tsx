import "server-only";

import { Suspense } from "react";

import { SaleDiscountBadge } from "@/entities/subscription";
import { CohortCallView } from "@/features/ai-engineering-course";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
import {
  fillPinnedOfferTerms,
  withoutPinnedOfferTerms,
} from "../api/home-with-offer-terms.server";
import {
  readHomeCourseAction,
  readHomeCourseDiscount,
} from "../api/home-course-action.server";
import type { HomePinnedCollection, HomeResult } from "../model/home-view";
import { HomePage } from "./home-page";

/** Общий закреп появляется сразу; доступ и продолжение заменяют только его кнопку. */
export function HomePageWithLearningAction({
  result,
}: {
  readonly result: HomeResult;
}) {
  return (
    <Suspense
      fallback={
        <HomeWithLearningAction result={withoutPinnedOfferTerms(result)} />
      }
    >
      <HomeWithOfferTerms result={result} />
    </Suspense>
  );
}
async function HomeWithOfferTerms({ result }: { readonly result: HomeResult }) {
  return <HomeWithLearningAction result={await fillPinnedOfferTerms(result)} />;
}
function HomeWithLearningAction({ result }: { readonly result: HomeResult }) {
  const product = result.kind === "ready" ? result.value.pinnedProduct : null;
  const course =
    product?.presentation === "ai-engineering-course" && product.hero !== null
      ? product
      : null;
  return (
    <HomePage
      result={result}
      courseCall={
        course === null ? undefined : (
          <Suspense fallback={<GuestCourseCall product={course} />}>
            <PersonalCourseCall product={course} />
          </Suspense>
        )
      }
      filmBadge={
        course === null ? undefined : (
          <Suspense fallback={null}>
            <CourseDiscountBadge product={course} />
          </Suspense>
        )
      }
    />
  );
}

/** Скидка приходит вместе с личным состоянием курса; без неё наклейки нет. */
async function CourseDiscountBadge({
  product,
}: {
  readonly product: HomePinnedCollection;
}) {
  const discount = await readHomeCourseDiscount(product.id, product.slug);
  return discount === null ? null : <SaleDiscountBadge discount={discount} />;
}

function GuestCourseCall({
  product,
}: {
  readonly product: HomePinnedCollection;
}) {
  // Тот, кто курс ещё не проходит, сначала открывает страницу курса (решение владельца
  // 23.11.2026).
  return (
    <CohortCallView
      call={{
        banner: null,
        action: {
          kind: "programme",
          href: collectionDiscoveryHref("product", product.slug, "/"),
          label: "Открыть курс",
        },
      }}
    />
  );
}

async function PersonalCourseCall({
  product,
}: {
  readonly product: HomePinnedCollection;
}) {
  const action = await readHomeCourseAction(product.id, product.slug);
  return action === null ? (
    <GuestCourseCall product={product} />
  ) : (
    <CohortCallView call={{ banner: null, action }} />
  );
}
