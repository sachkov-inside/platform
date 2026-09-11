import "server-only";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { resolveAccount } from "@/shared/api/backend/index.server";
import { getQueryClient } from "@/shared/api/query-client";
import { getSeriesContinuation } from "@/features/reading-progress.server";
import { seriesContinuationQueryKey } from "@/features/reading-progress";
import type { PriceSnapshot } from "@/entities/subscription";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";
import { SavedSeries } from "./saved-series.client";
export async function PersonalSeries({ result, accessToken, returnTarget, guideOffer = null }: {
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly accessToken?: string;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly guideOffer?: PriceSnapshot | null;
}) {
  const client = getQueryClient();
  let accountId: string | null = null;
  if (accessToken !== undefined) {
    try {
      accountId = (await resolveAccount(accessToken)).accountId;
      await client.query({ queryKey: seriesContinuationQueryKey(accountId, result.reference.slug), queryFn: () => getSeriesContinuation(result.reference.slug, accessToken) });
    } catch { accountId = null; }
  }
  return <HydrationBoundary state={dehydrate(client)}><SavedSeries result={result} initialAccountId={accountId} guideOffer={guideOffer} {...(returnTarget === undefined ? {} : { returnTarget })} /></HydrationBoundary>;
}
