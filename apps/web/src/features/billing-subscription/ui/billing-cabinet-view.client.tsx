"use client";
import Link from "next/link";
import type { Route } from "next";

import {
  billingActionClass,
  type ChangeQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type NoticeView,
  type PriceSnapshot,
  type SubscriptionView,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import {
  SubscriptionActions,
  type SubscriptionActionsProps,
} from "./subscription-actions.client";
import { SubscriptionNotices } from "./subscription-notices.client";
import { SubscriptionPlan } from "./subscription-plan.client";

export interface BillingCabinetViewProps
  extends Omit<
    SubscriptionActionsProps,
    "subscription" | "pending" | "storefrontHref"
  > {
  readonly subscription: SubscriptionView | null;
  readonly notices: readonly NoticeView[];
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
  readonly contactHref: Route;
  readonly onRefresh: () => void;
  readonly onCancelPendingChange: () => void;
  readonly onToggleResumeDocument: (kind: LegalDocumentKind) => void;
}

/**
 * Платёжный кабинет: что уже доступно, по какому основанию и до какого срока. Условия,
 * управление и служебные сообщения — три отдельные части одной страницы.
 */
export function BillingCabinetView({
  subscription,
  notices,
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
  contactHref,
  onRefresh,
  onCancelRenewal,
  onResumeRenewal,
  onToggleResumeDocument,
  onSelectOption,
  onQuoteChange,
  onConfirmChange,
  onCancelPendingChange,
  onChangeMethod,
  onRevokeMethod,
}: BillingCabinetViewProps) {
  if (sessionExpired) {
    return (
      <section className="mx-auto grid max-w-3xl gap-5">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em]">
          Платёжный кабинет
        </h1>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <p className="text-sm">Войдите, чтобы увидеть свою подписку.</p>
          <form action="/auth/sign-in" className="mt-4" method="post">
            <input name="returnTo" type="hidden" value="/account/subscription" />
            <Button className={billingActionClass} type="submit">
              Войти
            </Button>
          </form>
        </div>
      </section>
    );
  }

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header className="grid gap-2">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em]">
          Платёжный кабинет
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Здесь видно, что уже доступно, по какому основанию и до какого срока.
        </p>
      </header>

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
            onChangeMethod={onChangeMethod}
            onConfirmChange={onConfirmChange}
            onQuoteChange={onQuoteChange}
            onResumeRenewal={onResumeRenewal}
            onRevokeMethod={onRevokeMethod}
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

      <SubscriptionNotices contactHref={contactHref} notices={notices} />

      <div className="flex flex-wrap gap-2">
        <Button
          className={billingActionClass}
          disabled={loading || pending}
          onClick={onRefresh}
          type="button"
          variant="outline"
        >
          Обновить данные
        </Button>
      </div>

      {error === undefined ? null : (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}
