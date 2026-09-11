"use client";
import type { Route } from "next";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  acceptBillingConsents,
  type ChangeQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type PriceSnapshot,
} from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  cancelBillingChange,
  cancelBillingRenewal,
  changeBillingOption,
  quoteBillingChange,
  resumeBillingRenewal,
} from "../api/billing-subscription.browser";
import { assignLocation } from "../model/assign-location";
import { useBillingCabinet } from "../model/use-billing-cabinet.client";
import { SubscriptionSectionView } from "./subscription-view.client";

export interface SubscriptionPanelProps {
  readonly options: readonly PriceSnapshot[];
  readonly resumeDocuments: readonly LegalDocument[];
  /** Адрес витрины даётся, только когда подписку продают: иначе звать туда не с чем. */
  readonly storefrontHref?: Route | undefined;
  readonly onNavigate?: (url: string) => void;
}

/**
 * Производственный путь раздела «Подписка»: каждая команда возвращает новую revision, и она же
 * становится ожидаемой для следующей.
 */
export function SubscriptionPanel({
  options,
  resumeDocuments,
  storefrontHref,
  onNavigate,
}: SubscriptionPanelProps) {
  const cabinet = useBillingCabinet();
  const { operationId, completeOperation } = useRepeatableOperations();
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [changeQuote, setChangeQuote] = useState<ChangeQuote | null>(null);
  const [resumeAccepted, setResumeAccepted] = useState<
    readonly LegalDocumentKind[]
  >([]);
  const { subscription } = cabinet;

  const cancelRenewal = useMutation({
    mutationFn: cancelBillingRenewal,
    retry: false,
    onSuccess: (result) => {
      cabinet.settle(result, cabinet.applySubscription);
    },
  });
  const resumeRenewal = useMutation({
    retry: false,
    mutationFn: async (input: {
      readonly expectedRevision: number;
      readonly accepted: readonly LegalDocumentKind[];
    }) => {
      const commandId = operationId("resume", {
        expectedRevision: input.expectedRevision,
        accepted: input.accepted,
      });
      const selected = resumeDocuments.filter((document) =>
        input.accepted.includes(document.kind),
      );
      const consents = await acceptBillingConsents({
        operationId: operationId("resume-consents", { commandId }),
        contextRef: commandId,
        documents: selected.map((document) => ({
          kind: document.kind,
          documentId: document.documentId,
          version: document.version,
          digest: document.digest,
        })),
      });
      if (!consents.ok) return consents;
      return await resumeBillingRenewal({
        operationId: commandId,
        expectedRevision: input.expectedRevision,
        consentEvidenceRefs: [...consents.value.evidenceRefs],
      });
    },
    onSuccess: (result) => {
      cabinet.settle(result, (value) => {
        setResumeAccepted([]);
        cabinet.applySubscription(value);
      });
    },
  });
  const quoteChange = useMutation({
    mutationFn: quoteBillingChange,
    retry: false,
    onSuccess: (result) => {
      cabinet.settle(result, (value) => {
        completeOperation("change-quote");
        setChangeQuote(value);
      });
    },
  });
  const confirmChange = useMutation({
    mutationFn: changeBillingOption,
    retry: false,
    onSuccess: (result) => {
      cabinet.settle(
        result,
        (value) => {
          completeOperation("change");
          setChangeQuote(null);
          cabinet.applySubscription(value.subscription);
          const paymentUrl = value.payment?.paymentUrl ?? null;
          if (paymentUrl !== null) (onNavigate ?? assignLocation)(paymentUrl);
        },
        (code) => {
          // Устаревший расчёт нельзя подтверждать повторно: он больше не описывает условия.
          if (code === "quote_expired" || code === "quote_changed")
            setChangeQuote(null);
        },
      );
    },
  });
  const dropChange = useMutation({
    mutationFn: cancelBillingChange,
    retry: false,
    onSuccess: (result) => {
      cabinet.settle(result, cabinet.applySubscription);
    },
  });

  return (
    <SubscriptionSectionView
      changeQuote={changeQuote}
      error={cabinet.error}
      loading={cabinet.loading}
      onCancelPendingChange={() => {
        if (subscription === null) return;
        cabinet.setError(undefined);
        dropChange.mutate({
          operationId: operationId("change-cancel", {
            revision: subscription.revision,
          }),
          expectedRevision: subscription.revision,
        });
      }}
      onCancelRenewal={() => {
        if (subscription === null) return;
        cabinet.setError(undefined);
        cancelRenewal.mutate({
          operationId: operationId("cancel", {
            revision: subscription.revision,
          }),
          expectedRevision: subscription.revision,
        });
      }}
      onConfirmChange={() => {
        if (subscription === null || changeQuote === null) return;
        cabinet.setError(undefined);
        confirmChange.mutate({
          operationId: operationId("change", {
            changeQuoteRef: changeQuote.changeQuoteRef,
          }),
          expectedRevision: subscription.revision,
          changeQuoteRef: changeQuote.changeQuoteRef,
        });
      }}
      onQuoteChange={() => {
        if (subscription === null || selectedOptionId === null) return;
        cabinet.setError(undefined);
        setChangeQuote(null);
        quoteChange.mutate({
          operationId: operationId("change-quote", {
            revision: subscription.revision,
            paymentOptionId: selectedOptionId,
          }),
          expectedRevision: subscription.revision,
          paymentOptionId: selectedOptionId,
        });
      }}
      onResumeRenewal={() => {
        if (subscription === null) return;
        cabinet.setError(undefined);
        resumeRenewal.mutate({
          expectedRevision: subscription.revision,
          accepted: resumeAccepted,
        });
      }}
      onSelectOption={(paymentOptionId) => {
        setSelectedOptionId(paymentOptionId);
        setChangeQuote(null);
      }}
      onToggleResumeDocument={(kind) => {
        setResumeAccepted((value) =>
          value.includes(kind)
            ? value.filter((entry) => entry !== kind)
            : [...value, kind],
        );
      }}
      options={options}
      pending={
        cancelRenewal.isPending ||
        resumeRenewal.isPending ||
        quoteChange.isPending ||
        confirmChange.isPending ||
        dropChange.isPending
      }
      resumeAccepted={resumeAccepted}
      resumeDocuments={resumeDocuments}
      selectedOptionId={selectedOptionId}
      sessionExpired={cabinet.sessionExpired}
      storefrontHref={storefrontHref}
      subscription={subscription}
    />
  );
}
