import { Suspense, type ReactNode } from "react";

import { RetryPageButton } from "@/shared/ui/retry-page-button.client";

import type { HomeResult } from "../model/home-view";
import { FeaturedGuide } from "./featured-guide.client";
import { HomeFeed, HomeFeedLoading } from "./home-feed.client";
import { HomeFrame } from "./home-frame";

/**
 * Закреп уже в `result`; лента загружается ниже в своей границе Suspense (#562). Сбой закрепа
 * остаётся в памяти браузера на окно страницы (ADR 0027), поэтому рядом стоит повтор, идущий на сервер.
 */
export function HomePage({ result, feed }: { readonly result: HomeResult; readonly feed?: ReactNode }) {
  return <HomeFrame>
    {result.kind === "ready" && result.value.pinnedSeries !== null
      ? <FeaturedGuide series={result.value.pinnedSeries} />
      : result.kind === "unavailable"
        ? <div className="flex flex-wrap items-center gap-x-6 gap-y-3 py-8">
            <p className="text-muted-foreground" role="status">Не удалось загрузить продукт. Материалы доступны ниже.</p>
            <RetryPageButton />
          </div>
        : null}
    <Suspense fallback={<HomeFeedLoading />}>{feed ?? <HomeFeed />}</Suspense>
  </HomeFrame>;
}
