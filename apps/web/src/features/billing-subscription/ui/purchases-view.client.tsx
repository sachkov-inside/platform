"use client";
import { legalSeller } from "@inside/legal";
import type { Route } from "next";
import type { ReactNode } from "react";

import {
  type AccessGround,
  type NoticeView,
  type OwnPayment,
  type SubscriptionView,
} from "@/entities/subscription";

import { ProductAccessList } from "./product-access-list";
import { ProductPurchases } from "./product-purchases";
import { BillingHistory } from "./billing-history.client";
import { BillingSectionError } from "./billing-section-error.client";
import { BillingSignIn } from "./billing-sign-in";
import { PaymentMethodCard } from "./payment-method-card.client";
import { SubscriptionGrounds } from "./subscription-grounds.client";

export interface PurchasesSectionViewProps {
  /** Подтверждённый email: составляется страницей, потому что это отдельная поверхность. */
  readonly contactSlot?: ReactNode;
  /** Переход в сообщество Inside: отдельная поверхность, составляется страницей. */
  readonly communitySlot?: ReactNode;
  readonly grounds: readonly AccessGround[];
  readonly payments: readonly OwnPayment[];
  readonly notices: readonly NoticeView[];
  readonly subscription: SubscriptionView | null;
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly sessionExpired?: boolean;
  readonly storefrontHref?: Route | undefined;
  readonly onChangeMethod: () => void;
  readonly onRevokeMethod: () => void;
}

/**
 * Покупки отвечают на один вопрос: что уже доступно, по какому основанию, за какие деньги и
 * какой картой платим. Условия действующей подписки и управление ею живут в своём разделе.
 */
export function PurchasesSectionView({
  contactSlot,
  communitySlot,
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
      {grounds.some((ground) =>
        ground.content?.some((entry) => entry.kind === "product"),
      ) ? (
        <ProductAccessList grounds={grounds} />
      ) : (
        <SubscriptionGrounds
          grounds={grounds}
          loading={loading}
          storefrontHref={storefrontHref}
        />
      )}
      <ProductPurchases payments={payments} />
      {communitySlot}
      {contactSlot}
      {subscription === null ? null : (
        <PaymentMethodCard
          onChangeMethod={onChangeMethod}
          onRevokeMethod={onRevokeMethod}
          pending={pending}
          subscription={subscription}
        />
      )}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer font-semibold">
          История оплат, чеки и возвраты
        </summary>
        <BillingHistory notices={notices} payments={payments} />
      </details>
      <p className="text-sm text-muted-foreground">
        Для возврата обратитесь к продавцу:{" "}
        <a className="underline" href={`mailto:${legalSeller.email}`}>
          {legalSeller.email}
        </a>
        .
      </p>
      <BillingSectionError error={error} />
    </div>
  );
}
