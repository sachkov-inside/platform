"use client";
import {
  createContext,
  Suspense,
  use,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { HydrationBoundary, type DehydratedState } from "@tanstack/react-query";
import type { Route } from "next";
import {
  ProductOnboarding,
  useProductCommunityEntry,
} from "@/features/community-entry";
import { TelegramLinkAction } from "@/features/account-access";
import { useMaterialReading } from "@/entities/material";
import { useCurrentBilling } from "@/features/billing-subscription";
import { hasPaidProductAccess } from "../model/product-onboarding";
import { useProductLearning } from "./product-learning.client";

interface OnboardingPresentation {
  readonly incomplete: boolean;
  readonly panel: ReactNode;
}
const ProductOnboardingContext = createContext<
  OnboardingPresentation | null | undefined
>(undefined);
export function useProductOnboardingPresentation() {
  return use(ProductOnboardingContext);
}

/**
 * Browser-owned personal facts surround the server-rendered programme composition. The server
 * facts of the onboarding stream in beside the programme rather than around it (#1883): a
 * `Suspense` fallback is never reused for the arriving content, so a programme inside it would be
 * replaced and lose the part the reader selected. Until they arrive, the onboarding is unknown.
 */
export function ProductProgrammeOnboarding({
  accountId,
  productId,
  productName,
  firstLessonHref,
  onboarding = null,
  children,
}: {
  readonly accountId: string | null;
  readonly productId: string | undefined;
  readonly productName: string;
  readonly firstLessonHref: Route | null;
  /** Server query state of the onboarding; `null` when the server has nothing to add. */
  readonly onboarding?: Promise<DehydratedState> | null;
  readonly children: ReactNode;
}) {
  const [arrived, setArrived] = useState(onboarding === null);
  const reading = useMaterialReading();
  const currentAccountId = reading.resolved ? reading.accountId : accountId;
  const billing = useCurrentBilling({
    enabled: arrived && currentAccountId !== null && productId !== undefined,
  });
  const purchased =
    currentAccountId !== null &&
    productId !== undefined &&
    billing.data?.ok === true &&
    hasPaidProductAccess(billing.data.value.access.grounds, productId);
  const query = useProductCommunityEntry(
    productId ?? "",
    currentAccountId,
    purchased,
  );
  const learning = useProductLearning();
  const result = query.data;
  const entry = result?.ok === true ? result.value : null;
  const complete =
    entry?.kind === "member" &&
    learning.kind === "ready" &&
    learning.started === true;
  const error = query.isError || result?.ok === false;
  const presentation =
    !purchased || complete || entry === null
      ? null
      : {
          incomplete: true,
          panel: (
            <ProductOnboarding
              productName={productName}
              entry={entry}
              error={error}
              onRefresh={() => {
                void query.refetch();
              }}
              firstLessonHref={firstLessonHref}
              telegramAction={
                <TelegramLinkAction
                  className="min-h-12 w-full"
                  label="Подключить Telegram"
                  onRefresh={async () => {
                    await query.refetch();
                  }}
                />
              }
            />
          ),
        };
  return (
    <ProductOnboardingContext value={arrived ? presentation : undefined}>
      {children}
      {onboarding === null ? null : (
        <Suspense fallback={null}>
          <OnboardingArrival onArrived={setArrived} state={onboarding} />
        </Suspense>
      )}
      {purchased && error && entry === null ? (
        <p role="alert" className="mt-4 text-sm">
          Не удалось проверить подключение к продукту.
        </p>
      ) : null}
    </ProductOnboardingContext>
  );
}

/** Hydrates the server onboarding facts once they stream in, then reports their arrival. */
function OnboardingArrival({
  state,
  onArrived,
}: {
  readonly state: Promise<DehydratedState>;
  readonly onArrived: (arrived: true) => void;
}) {
  return (
    <HydrationBoundary state={use(state)}>
      <ArrivalSignal onArrived={onArrived} />
    </HydrationBoundary>
  );
}

function ArrivalSignal({
  onArrived,
}: {
  readonly onArrived: (arrived: true) => void;
}) {
  // Before paint, so the onboarding part does not appear one frame after its facts.
  useLayoutEffect(() => {
    onArrived(true);
  }, [onArrived]);
  return null;
}
