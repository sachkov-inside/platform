"use client";
import { createContext, use, type ReactNode } from "react";
import type { Route } from "next";
import {
  ProductOnboarding,
  useProductCommunityEntry,
} from "@/features/community-entry";
import { TelegramLinkAction } from "@/features/account-access";
import { useSeriesLearning } from "./series-learning.client";

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

/** Browser-owned personal facts surround the server-rendered programme composition. */
export function ProductProgrammeOnboarding({
  accountId,
  productId,
  productName,
  firstLessonHref,
  children,
}: {
  readonly accountId: string | null;
  readonly productId: string | undefined;
  readonly productName: string;
  readonly firstLessonHref: Route | null;
  readonly children: ReactNode;
}) {
  const query = useProductCommunityEntry(
    productId ?? "",
    accountId !== null && productId !== undefined,
  );
  const learning = useSeriesLearning();
  const result = query.data;
  const entry = result?.ok === true ? result.value : null;
  const complete =
    entry?.kind === "member" &&
    learning.kind === "ready" &&
    learning.started === true;
  const error = query.isError || result?.ok === false;
  const presentation =
    accountId === null || entry?.kind === "none" || complete || entry === null
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
                  label="Привязать Telegram"
                  onRefresh={async () => {
                    await query.refetch();
                  }}
                />
              }
            />
          ),
        };
  return (
    <ProductOnboardingContext value={presentation}>
      {children}
      {error && entry === null ? (
        <p role="alert" className="mt-4 text-sm">
          Не удалось проверить онбординг продукта.
        </p>
      ) : null}
    </ProductOnboardingContext>
  );
}
