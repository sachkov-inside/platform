import { Suspense, type ReactNode } from "react";

import type { HomeResult } from "../model/home-view";
import { FeaturedGuide } from "./featured-guide.client";
import { HomeFeed, HomeFeedLoading } from "./home-feed.client";
import { HomeFrame } from "./home-frame";

export function HomePage({ result, feed }: { readonly result: HomeResult; readonly feed?: ReactNode }) {
  return <HomeFrame>
    {result.kind === "ready" && result.value.pinnedSeries !== null
      ? <FeaturedGuide series={result.value.pinnedSeries} />
      : result.kind === "unavailable"
        ? <p className="py-8 text-muted-foreground" role="status">Не удалось загрузить практикум. Материалы доступны ниже.</p>
        : null}
    {feed ?? <Suspense fallback={<HomeFeedLoading />}><HomeFeed /></Suspense>}
  </HomeFrame>;
}
