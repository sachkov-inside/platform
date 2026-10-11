import "server-only";

import { Suspense } from "react";

import { CohortCallView } from "@/features/ai-engineering-course";
import { collectionDiscoveryHref } from "@/shared/routing/material-reader";
import { hasText } from "@/shared/lib/text";
import { readHomeCourseAction } from "../api/home-course-action.server";
import type { HomePinnedCollection, HomeResult } from "../model/home-view";
import { HomePage } from "./home-page";

/** Общий закреп появляется сразу; доступ и продолжение заменяют только его кнопку. */
export function HomePageWithLearningAction({
  result,
}: {
  readonly result: HomeResult;
}) {
  const series = result.kind === "ready" ? result.value.pinnedSeries : null;
  return (
    <HomePage
      result={result}
      courseCall={
        series?.presentation === "ai-engineering-course" &&
        series.hero !== null ? (
          <Suspense fallback={<GuestCourseCall series={series} />}>
            <PersonalCourseCall series={series} />
          </Suspense>
        ) : undefined
      }
    />
  );
}

function GuestCourseCall({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  return (
    <CohortCallView
      call={{
        banner: null,
        action: {
          kind: "programme",
          href: collectionDiscoveryHref("series", series.slug, "/"),
          label: hasText(series.card?.action)
            ? series.card.action
            : "Открыть курс",
        },
      }}
    />
  );
}

async function PersonalCourseCall({
  series,
}: {
  readonly series: HomePinnedCollection;
}) {
  const action = await readHomeCourseAction(series.id, series.slug);
  return action === null ? (
    <GuestCourseCall series={series} />
  ) : (
    <CohortCallView call={{ banner: null, action }} />
  );
}
