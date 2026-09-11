"use client";
import type { Route } from "next";

import {
  billingActionClass,
  type AccessGround,
  type NoticeView,
  type OwnPayment,
  type SubscriptionView,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import { BillingHistory } from "./billing-history.client";
import { BillingSignIn } from "./billing-sign-in";
import { PaymentMethodCard } from "./payment-method-card.client";
import { SubscriptionGrounds } from "./subscription-grounds.client";

export interface PurchasesViewProps {
  readonly grounds: readonly AccessGround[];
  readonly payments: readonly OwnPayment[];
  readonly notices: readonly NoticeView[];
  readonly subscription: SubscriptionView | null;
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly sessionExpired?: boolean;
  readonly storefrontHref: Route;
  readonly onRefresh: () => void;
  readonly onChangeMethod: () => void;
  readonly onRevokeMethod: () => void;
}

/**
 * Покупки отвечают на один вопрос: что уже доступно, по какому основанию, за какие деньги и
 * какой картой платим. Условия действующей подписки и управление ею живут в своём разделе.
 */
export function PurchasesView({
  grounds,
  payments,
  notices,
  subscription,
  loading = false,
  pending = false,
  error,
  sessionExpired = false,
  storefrontHref,
  onRefresh,
  onChangeMethod,
  onRevokeMethod,
}: PurchasesViewProps) {
  if (sessionExpired) {
    return (
      <BillingSignIn
        description="Войдите, чтобы увидеть свои покупки и основания доступа."
        returnTo="/account/purchases"
      />
    );
  }

  return (
    <div className="grid gap-6">
      <SubscriptionGrounds
        grounds={grounds}
        loading={loading}
        storefrontHref={storefrontHref}
      />
      <PaymentMethodCard
        onChangeMethod={onChangeMethod}
        onRevokeMethod={onRevokeMethod}
        pending={pending}
        subscription={subscription}
      />
      <BillingHistory notices={notices} payments={payments} />
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
