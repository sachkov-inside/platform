import "server-only";
import { Suspense, type ComponentProps } from "react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { resolveAccount } from "@/shared/api/backend/index.server";
import { getQueryClient } from "@/shared/api/query-client";
import {
  readProductReaderState,
  type ProductReaderState,
} from "@/widgets/product-reader-state/index.server";
import { currentBillingQueryKey } from "@/features/billing-subscription";
import { productCommunityQueryKey } from "@/features/community-entry";
import { productContinuationQueryKey } from "@/features/reading-progress";
import type { PreorderPrice, PriceSnapshot } from "@/entities/subscription";
import type { ReaderProductArtifactsResult } from "@/features/product-artifacts.reader";
import type { PublishedProductResult } from "@/features/library-discovery";
import {
  ProductProgrammeView,
  programmePurchase,
} from "./product-programme-view";
import { ProductProgrammeOnboarding } from "./product-programme-onboarding.client";
import {
  materialReaderHref,
  productReaderReturnHref,
} from "@/shared/routing/material-reader";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { ProductLearningSource } from "./product-learning.client";

/** Личная часть программы: состав глазами читателя рисует сервер, прогресс продолжает браузер. */
export async function PersonalProduct({
  artifacts,
  result,
  accessToken,
  readerState,
  preorder = null,
  productOffer = null,
  subscriptionOffered = false,
}: {
  readonly artifacts: ReaderProductArtifactsResult;
  readonly result: Extract<PublishedProductResult, { kind: "ready" | "empty" }>;
  readonly accessToken?: string;
  readonly readerState?: ProductReaderState;
  /** Цена предзаказа рядом с ценой после старта, пока поток набирается. */
  readonly preorder?: PreorderPrice | null;
  readonly productOffer?: PriceSnapshot | null;
  readonly subscriptionOffered?: boolean;
}) {
  const client = getQueryClient();
  let accountId: string | null = null;
  let onboarding:
    Extract<ProductReaderState, { kind: "learning" }>["onboarding"] | null =
    null;
  let productOpen = false;
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
      productOpen = state?.access === "open";
      if (state?.kind === "learning") {
        client.setQueryData(
          productContinuationQueryKey(accountId, result.reference.slug),
          state.continuation,
        );
        onboarding = state.onboarding;
      }
    } catch {
      accountId = null;
    }
  }
  const programme = (
    <ProductProgrammeView
      artifacts={artifacts}
      preorder={preorder}
      productOffer={productOffer}
      productOpen={productOpen}
      result={result}
      subscriptionOffered={subscriptionOffered}
    />
  );
  return (
    <HydrationBoundary state={dehydrate(client)}>
      <ProductLearningSource
        initialAccountId={accountId}
        purchaseRowShown={
          programmePurchase({ productOffer, result, subscriptionOffered }) !==
          null
        }
        slug={result.reference.slug}
      >
        <Suspense fallback={programme}>
          <OptionalProgrammeOnboarding
            onboarding={onboarding}
            accountId={accountId}
            productId={result.reference.id}
            productName={result.reference.name}
            firstLessonHref={
              result.kind === "ready" && result.items[0] !== undefined
                ? materialReaderHref(
                    result.items[0].slug,
                    productReaderReturnHref(
                      productProgrammeHref(result.reference.slug),
                      1,
                      result.items[0].slug,
                    ),
                  )
                : null
            }
          >
            {programme}
          </OptionalProgrammeOnboarding>
        </Suspense>
      </ProductLearningSource>
    </HydrationBoundary>
  );
}

/** Optional onboarding streams independently; the same usable programme is the fallback. */
async function OptionalProgrammeOnboarding({
  onboarding,
  ...props
}: ComponentProps<typeof ProductProgrammeOnboarding> & {
  readonly onboarding:
    Extract<ProductReaderState, { kind: "learning" }>["onboarding"] | null;
}) {
  const facts = await onboarding;
  const client = getQueryClient();
  if (facts !== null && "billing" in facts)
    client.setQueryData(currentBillingQueryKey, {
      ok: true,
      value: facts.billing,
    });
  if (
    facts?.kind === "ready" &&
    props.accountId !== null &&
    props.productId !== undefined
  )
    client.setQueryData(
      productCommunityQueryKey(props.accountId, props.productId),
      { ok: true, value: facts.entry },
    );
  return (
    <HydrationBoundary state={dehydrate(client)}>
      <ProductProgrammeOnboarding {...props} />
    </HydrationBoundary>
  );
}
