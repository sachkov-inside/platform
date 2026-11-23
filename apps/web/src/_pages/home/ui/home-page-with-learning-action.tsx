import "server-only";

import { Suspense } from "react";

import { CohortCallView } from "@/features/ai-engineering-course";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import {
  fillPinnedOfferTerms,
  withoutPinnedOfferTerms,
} from "../api/home-with-offer-terms.server";
import { readHomeCourseAction } from "../api/home-course-action.server";
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
  return (
    <HomePage
      result={result}
      courseCall={
        product?.presentation === "ai-engineering-course" &&
        product.hero !== null ? (
          <Suspense fallback={<GuestCourseCall product={product} />}>
            <PersonalCourseCall product={product} />
          </Suspense>
        ) : undefined
      }
    />
  );
}

function GuestCourseCall({
  product,
}: {
  readonly product: HomePinnedCollection;
}) {
  return (
    <CohortCallView
      call={{
        banner: null,
        action: {
          kind: "programme",
          href: productProgrammeHref(product.slug),
          label: "Посмотреть программу",
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
