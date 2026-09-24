import "server-only";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { resolveAccount } from "@/shared/api/backend/index.server";
import { getQueryClient } from "@/shared/api/query-client";
import { getSeriesContinuation } from "@/features/reading-progress.server";
import { seriesContinuationQueryKey } from "@/features/reading-progress";
import type { PriceSnapshot } from "@/entities/subscription";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { GuideProgrammeView, programmePurchase } from "./guide-programme-view";
import { SeriesLearningSource } from "./series-learning.client";

/** Личная часть программы: состав глазами читателя рисует сервер, прогресс продолжает браузер. */
export async function PersonalSeries({ artifacts, result, accessToken, guideOffer = null, subscriptionOffered = false }: {
  readonly artifacts: ReaderGuideArtifactsResult;
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly accessToken?: string;
  readonly guideOffer?: PriceSnapshot | null;
  readonly subscriptionOffered?: boolean;
}) {
  const client = getQueryClient();
  let accountId: string | null = null;
  if (accessToken !== undefined) {
    try {
      accountId = (await resolveAccount(accessToken)).accountId;
      await client.query({ queryKey: seriesContinuationQueryKey(accountId, result.reference.slug), queryFn: () => getSeriesContinuation(result.reference.slug, accessToken) });
    } catch { accountId = null; }
  }
  return <HydrationBoundary state={dehydrate(client)}>
    <SeriesLearningSource
      initialAccountId={accountId}
      purchaseRowShown={programmePurchase({ guideOffer, result, subscriptionOffered }) !== null}
      slug={result.reference.slug}
    >
      <GuideProgrammeView artifacts={artifacts} guideOffer={guideOffer} result={result} subscriptionOffered={subscriptionOffered} />
    </SeriesLearningSource>
  </HydrationBoundary>;
}
