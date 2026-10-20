"use client";
import type { ReactNode } from "react";
import { WorkspaceTabs } from "@/shared/ui/workspace-tabs.client";
import type { PriceSnapshot } from "@/entities/subscription";

import { BillingAdminFrame } from "./billing-admin-frame";
import {
  CatalogSection,
  type CatalogSectionProps,
} from "./catalog-section.client";
import {
  CohortSection,
  type CohortSectionProps,
} from "./cohort-section.client";
import {
  ClassificationSection,
  type ClassificationSectionProps,
} from "./classification-section.client";
import {
  GrantsSection,
  type GrantsSectionProps,
} from "./grants-section.client";
import {
  PaymentsSection,
  type PaymentsSectionProps,
} from "./payments-section.client";

export interface BillingAdminViewProps
  extends
    Omit<CatalogSectionProps, "offers" | "pending">,
    Omit<CohortSectionProps, "content" | "pending">,
    Omit<PaymentsSectionProps, "pending">,
    Omit<GrantsSectionProps, "pending">,
    Omit<ClassificationSectionProps, "pending"> {
  readonly offers: readonly PriceSnapshot[];
  readonly enrollmentControls?: ReactNode;
  /** Historical survey facts remain readable beside the common payment-link workflow. */
  readonly respondentControls?: ReactNode;
  readonly paymentLinkControls?: ReactNode;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly notice?: string | undefined;
}

/**
 * Владельческий кабинет billing: те же операции и полномочия, что у admin API и MCP.
 * Каждый раздел отвечает за свою группу операций, а страница — за общий исход команды.
 */
export function BillingAdminView({
  content,
  tiers,
  catalogLoading,
  catalogError,
  cohorts,
  onSaveCohort,
  enrollmentControls,
  respondentControls,
  paymentLinkControls,
  offers,
  payments,
  paymentsCursor,
  paymentsFilters,
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
    <BillingAdminFrame>
      <header className="authoring-page-heading">
        <h1 className="text-balance text-3xl font-bold tracking-[-0.04em]">
          Продажи и платежи
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Платежи, предложения и ссылки на оплату. Возвраты выполняются в
          кабинете Т-Банка.
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

      <WorkspaceTabs
        label="Разделы продаж"
        tabs={[
          {
            id: "payments",
            label: "Платежи",
            panel: (
              <PaymentsSection
                onCancelSubscription={onCancelSubscription}
                onListPayments={onListPayments}
                onReadPayment={onReadPayment}
                onReadRefunds={onReadRefunds}
                onReconcilePayment={onReconcilePayment}
                payment={payment}
                payments={payments}
                paymentsCursor={paymentsCursor}
                paymentsFilters={paymentsFilters}
                pending={pending}
                refunds={refunds}
              />
            ),
          },
          {
            id: "catalog",
            label: "Предложения",
            panel: (
              <CatalogSection
                content={content}
                tiers={tiers}
                catalogLoading={catalogLoading}
                catalogError={catalogError}
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
            ),
          },
          {
            id: "links",
            label: "Ссылки на оплату",
            panel: (
              <>
                {paymentLinkControls}
                <details className="authoring-disclosure">
                  <summary>Архив анкетных скидок</summary>
                  {respondentControls}
                </details>
              </>
            ),
          },
          {
            id: "cohorts",
            label: "Наборы",
            panel: (
              <CohortSection
                cohorts={cohorts}
                content={content}
                onSaveCohort={onSaveCohort}
                pending={pending}
              />
            ),
          },
          {
            id: "assignments",
            label: "Назначения и перенос",
            panel: enrollmentControls,
          },
          {
            id: "advanced",
            label: "Служебные операции",
            panel: (
              <WorkspaceTabs
                label="Операции с доступом"
                tabs={[
                  {
                    id: "grants",
                    label: "Основания и массовая выдача",
                    panel: (
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
                    ),
                  },
                  {
                    id: "classification",
                    label: "Классификация аккаунта",
                    panel: (
                      <ClassificationSection
                        classification={classification}
                        onClassifyAccount={onClassifyAccount}
                        onReadClassification={onReadClassification}
                        pending={pending}
                      />
                    ),
                  },
                ]}
              />
            ),
          },
        ]}
      />
    </BillingAdminFrame>
  );
}
