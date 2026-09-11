"use client";
import type { Route } from "next";
import type { ReactNode } from "react";

import {
  type AccessGround,
  type NoticeView,
  type OwnPayment,
  type SubscriptionView,
} from "@/entities/subscription";

import { BillingHistory } from "./billing-history.client";
import { BillingSectionError } from "./billing-section-error.client";
import { BillingSignIn } from "./billing-sign-in";
import { PaymentMethodCard } from "./payment-method-card.client";
import { SubscriptionGrounds } from "./subscription-grounds.client";

export interface PurchasesSectionViewProps {
  /** Подтверждённый email: составляется страницей, потому что это отдельная поверхность. */
  readonly contactSlot?: ReactNode;
  readonly grounds: readonly AccessGround[];
  readonly payments: readonly OwnPayment[];
  readonly notices: readonly NoticeView[];
  readonly subscription: SubscriptionView | null;
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly sessionExpired?: boolean;
  readonly storefrontHref: Route;
  readonly onChangeMethod: () => void;
  readonly onRevokeMethod: () => void;
}

/**
 * Покупки отвечают на один вопрос: что уже доступно, по какому основанию, за какие деньги и
 * какой картой платим. Условия действующей подписки и управление ею живут в своём разделе.
 */
export function PurchasesSectionView({
  contactSlot,
  grounds,
  payments,
  notices,
  subscription,
  loading = false,
  pending = false,
  error,
  sessionExpired = false,
  storefrontHref,
  onChangeMethod,
  onRevokeMethod,
}: PurchasesSectionViewProps) {
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
      {contactSlot}
      <PaymentMethodCard
        onChangeMethod={onChangeMethod}
        onRevokeMethod={onRevokeMethod}
        pending={pending}
        subscription={subscription}
      />
      <BillingHistory notices={notices} payments={payments} />
      <BillingSectionError error={error} />
    </div>
  );
}
