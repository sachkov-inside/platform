"use client";
import Link from "next/link";
import type { Route } from "next";

import {
  type ChangeQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type PriceSnapshot,
  type SubscriptionView,
} from "@/entities/subscription";

import { BillingSectionFooter } from "./billing-section-footer.client";
import { BillingSignIn } from "./billing-sign-in";
import {
  SubscriptionActions,
  type SubscriptionActionsProps,
} from "./subscription-actions.client";
import { SubscriptionPlan } from "./subscription-plan.client";

export interface SubscriptionSectionViewProps
  extends Omit<
    SubscriptionActionsProps,
    "subscription" | "pending" | "storefrontHref"
  > {
  readonly subscription: SubscriptionView | null;
  readonly options: readonly PriceSnapshot[];
  readonly selectedOptionId: string | null;
  readonly changeQuote: ChangeQuote | null;
  readonly resumeDocuments: readonly LegalDocument[];
  readonly resumeAccepted: readonly LegalDocumentKind[];
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly sessionExpired?: boolean;
  readonly storefrontHref: Route;
  readonly onRefresh: () => void;
  readonly onCancelPendingChange: () => void;
}

/**
 * Действующие условия подписки и управление ими. История денег и способ оплаты принадлежат
 * разделу «Покупки»: ни один раздел не показывает задачи другого.
 */
export function SubscriptionSectionView({
  subscription,
  options,
  selectedOptionId,
  changeQuote,
  resumeDocuments,
  resumeAccepted,
  loading = false,
  pending = false,
  error,
  sessionExpired = false,
  storefrontHref,
  onRefresh,
  onCancelRenewal,
  onResumeRenewal,
  onToggleResumeDocument,
  onSelectOption,
  onQuoteChange,
  onConfirmChange,
  onCancelPendingChange,
}: SubscriptionSectionViewProps) {
  if (sessionExpired) {
    return (
      <BillingSignIn
        description="Войдите, чтобы увидеть свою подписку."
        returnTo="/account/subscription"
      />
    );
  }

  return (
    <div className="grid gap-6">
      {loading && subscription === null ? (
        <p role="status">Загружаем подписку…</p>
      ) : subscription === null ? (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-xl font-semibold">Действующей подписки нет</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Ранее выданные права остаются в силе на своих условиях: подписка их
            не заменяет.
          </p>
          <Link
            className="mt-4 inline-flex min-h-11 items-center font-semibold text-action underline underline-offset-4"
            href={storefrontHref}
          >
            Посмотреть тарифы
          </Link>
        </section>
      ) : (
        <>
          <SubscriptionPlan
            onCancelPendingChange={onCancelPendingChange}
            pending={pending}
            subscription={subscription}
          />
          <SubscriptionActions
            changeQuote={changeQuote}
            onCancelRenewal={onCancelRenewal}
            onConfirmChange={onConfirmChange}
            onQuoteChange={onQuoteChange}
            onResumeRenewal={onResumeRenewal}
            onSelectOption={onSelectOption}
            onToggleResumeDocument={onToggleResumeDocument}
            options={options}
            pending={pending}
            resumeAccepted={resumeAccepted}
            resumeDocuments={resumeDocuments}
            selectedOptionId={selectedOptionId}
            storefrontHref={storefrontHref}
            subscription={subscription}
          />
        </>
      )}

      <BillingSectionFooter
        disabled={loading || pending}
        error={error}
        onRefresh={onRefresh}
      />
    </div>
  );
}
