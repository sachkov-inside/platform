import "server-only";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { resolveAccount } from "@/shared/api/backend/index.server";
import { getQueryClient } from "@/shared/api/query-client";
import { getSeriesContinuation } from "@/features/reading-progress.server";
import { seriesContinuationQueryKey } from "@/features/reading-progress";
import type { PriceSnapshot } from "@/entities/subscription";
import type { ReaderProductArtifactsResult } from "@/features/product-artifacts.reader";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import {
  ProductProgrammeView,
  programmePurchase,
} from "./product-programme-view";
import { SeriesLearningSource } from "./series-learning.client";

/** Личная часть программы: состав глазами читателя рисует сервер, прогресс продолжает браузер. */
export async function PersonalSeries({
  artifacts,
  result,
  accessToken,
  productOffer = null,
  subscriptionOffered = false,
}: {
  readonly artifacts: ReaderProductArtifactsResult;
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly accessToken?: string;
  readonly productOffer?: PriceSnapshot | null;
  readonly subscriptionOffered?: boolean;
}) {
  const client = getQueryClient();
  let accountId: string | null = null;
  if (accessToken !== undefined) {
    try {
      accountId = (await resolveAccount(accessToken)).accountId;
      await client.query({
        queryKey: seriesContinuationQueryKey(accountId, result.reference.slug),
        queryFn: () =>
          getSeriesContinuation(result.reference.slug, accessToken),
      });
    } catch {
      accountId = null;
    }
  }
  return (
    <HydrationBoundary state={dehydrate(client)}>
      <SeriesLearningSource
        initialAccountId={accountId}
        purchaseRowShown={
          programmePurchase({ productOffer, result, subscriptionOffered }) !==
          null
        }
        slug={result.reference.slug}
      >
        <ProductProgrammeView
          artifacts={artifacts}
          productOffer={productOffer}
          result={result}
          subscriptionOffered={subscriptionOffered}
        />
      </SeriesLearningSource>
    </HydrationBoundary>
  );
}
