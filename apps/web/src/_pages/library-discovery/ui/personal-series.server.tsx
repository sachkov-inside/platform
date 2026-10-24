import "server-only";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { resolveAccount } from "@/shared/api/backend/index.server";
import { getQueryClient } from "@/shared/api/query-client";
import {
  readProductReaderState,
  type ProductReaderState,
} from "@/widgets/product-reader-state/index.server";
import { currentBillingQueryKey } from "@/features/billing-subscription";
import { productCommunityQueryKey } from "@/features/community-entry";
import { seriesContinuationQueryKey } from "@/features/reading-progress";
import type { PreorderPrice, PriceSnapshot } from "@/entities/subscription";
import type { ReaderProductArtifactsResult } from "@/features/product-artifacts.reader";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import {
  ProductProgrammeView,
  programmePurchase,
} from "./product-programme-view";
import { ProductProgrammeOnboarding } from "./product-programme-onboarding.client";
import {
  materialReaderHref,
  seriesReaderReturnHref,
} from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { SeriesLearningSource } from "./series-learning.client";

/** Личная часть программы: состав глазами читателя рисует сервер, прогресс продолжает браузер. */
export async function PersonalSeries({
  artifacts,
  result,
  accessToken,
  readerState,
  preorder = null,
  productOffer = null,
  subscriptionOffered = false,
}: {
  readonly artifacts: ReaderProductArtifactsResult;
  readonly result: Extract<PublishedSeriesResult, { kind: "ready" | "empty" }>;
  readonly accessToken?: string;
  readonly readerState?: ProductReaderState;
  /** Цена предзаказа рядом с ценой после старта, пока поток набирается. */
  readonly preorder?: PreorderPrice | null;
  readonly productOffer?: PriceSnapshot | null;
  readonly subscriptionOffered?: boolean;
}) {
  const client = getQueryClient();
  let accountId: string | null = null;
  if (accessToken !== undefined) {
    try {
      accountId = (await resolveAccount(accessToken)).accountId;
      const state =
        readerState ??
        (result.reference.id === undefined
          ? null
          : await readProductReaderState(
              result.reference.id,
              result.reference.slug,
            ));
      if (state?.kind === "learning") {
        client.setQueryData(
          seriesContinuationQueryKey(accountId, result.reference.slug),
          state.continuation,
        );
        if ("billing" in state.onboarding)
          client.setQueryData(currentBillingQueryKey, {
            ok: true,
            value: state.onboarding.billing,
          });
        if (state.onboarding.kind === "ready")
          client.setQueryData(
            productCommunityQueryKey(accountId, state.productId),
            { ok: true, value: state.onboarding.entry },
          );
      }
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
        <ProductProgrammeOnboarding
          accountId={accountId}
          productId={result.reference.id}
          productName={result.reference.name}
          firstLessonHref={
            result.kind === "ready" && result.items[0] !== undefined
              ? materialReaderHref(
                  result.items[0].slug,
                  seriesReaderReturnHref(
                    productProgrammeHref(result.reference.slug),
                    1,
                    result.items[0].slug,
                  ),
                )
              : null
          }
        >
          <ProductProgrammeView
            artifacts={artifacts}
            preorder={preorder}
            productOffer={productOffer}
            result={result}
            subscriptionOffered={subscriptionOffered}
          />
        </ProductProgrammeOnboarding>
      </SeriesLearningSource>
    </HydrationBoundary>
  );
}
