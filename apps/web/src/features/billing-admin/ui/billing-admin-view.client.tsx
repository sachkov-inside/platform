"use client";
import type { PriceSnapshot } from "@/entities/subscription";

import { CatalogSection, type CatalogSectionProps } from "./catalog-section.client";
import {
  ClassificationSection,
  type ClassificationSectionProps,
} from "./classification-section.client";
import { GrantsSection, type GrantsSectionProps } from "./grants-section.client";
import {
  PaymentsSection,
  type PaymentsSectionProps,
} from "./payments-section.client";

export interface BillingAdminViewProps
  extends Omit<CatalogSectionProps, "offers" | "pending">,
    Omit<PaymentsSectionProps, "pending">,
    Omit<GrantsSectionProps, "pending">,
    Omit<ClassificationSectionProps, "pending"> {
  readonly offers: readonly PriceSnapshot[];
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly notice?: string | undefined;
}

/**
 * Владельческий кабинет billing: те же операции и полномочия, что у admin API и MCP.
 * Каждый раздел отвечает за свою группу операций, а страница — за общий исход команды.
 */
export function BillingAdminView({
  offers,
  payments,
  paymentsCursor,
  payment,
  refunds,
  grants,
  classification,
  preview,
  batch,
  pending = false,
  error,
  notice,
  onSaveOffer,
  onArchiveOffer,
  onPublishOffer,
  onUnpublishOffer,
  onSavePaymentOption,
  onArchivePaymentOption,
  onSavePromotion,
  onArchivePromotion,
  onListPayments,
  onReadPayment,
  onReconcilePayment,
  onReadRefunds,
  onDecideRefund,
  onExecuteRefund,
  onCancelSubscription,
  onReadGrants,
  onReadClassification,
  onClassifyAccount,
  onExtendGrant,
  onRevokeGrant,
  onPreviewBatch,
  onApplyBatch,
}: BillingAdminViewProps) {
  return (
    <div className="mx-auto grid max-w-4xl gap-6 pb-16">
      <header className="grid gap-2">
        <h1 className="text-balance text-3xl font-bold tracking-[-0.04em]">
          Оплата и права
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Проверенные владельческие операции вместо правки базы. Реальные
          возвраты, выдачи и смена терминала требуют отдельного разрешения.
        </p>
      </header>

      {notice === undefined ? null : (
        <p
          className="rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm"
          role="status"
        >
          {notice}
        </p>
      )}
      {error === undefined ? null : (
        <p
          className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm"
          role="alert"
        >
          {error}
        </p>
      )}

      <CatalogSection
        offers={offers}
        onArchiveOffer={onArchiveOffer}
        onPublishOffer={onPublishOffer}
        onUnpublishOffer={onUnpublishOffer}
        onArchivePaymentOption={onArchivePaymentOption}
        onArchivePromotion={onArchivePromotion}
        onSaveOffer={onSaveOffer}
        onSavePaymentOption={onSavePaymentOption}
        onSavePromotion={onSavePromotion}
        pending={pending}
      />
      <PaymentsSection
        onCancelSubscription={onCancelSubscription}
        onDecideRefund={onDecideRefund}
        onExecuteRefund={onExecuteRefund}
        onListPayments={onListPayments}
        onReadPayment={onReadPayment}
        onReadRefunds={onReadRefunds}
        onReconcilePayment={onReconcilePayment}
        payment={payment}
        payments={payments}
        paymentsCursor={paymentsCursor}
        pending={pending}
        refunds={refunds}
      />
      <ClassificationSection
        classification={classification}
        onClassifyAccount={onClassifyAccount}
        onReadClassification={onReadClassification}
        pending={pending}
      />
      <GrantsSection
        batch={batch}
        grants={grants}
        onApplyBatch={onApplyBatch}
        onExtendGrant={onExtendGrant}
        onPreviewBatch={onPreviewBatch}
        onReadGrants={onReadGrants}
        onRevokeGrant={onRevokeGrant}
        pending={pending}
        preview={preview}
      />
    </div>
  );
}
