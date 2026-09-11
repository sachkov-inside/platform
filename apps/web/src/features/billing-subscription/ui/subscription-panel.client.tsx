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
import { useBillingCabinet } from "../model/use-billing-cabinet.client";
import { SubscriptionSectionView } from "./subscription-view.client";

export interface SubscriptionPanelProps {
  readonly options: readonly PriceSnapshot[];
  readonly resumeDocuments: readonly LegalDocument[];
  readonly storefrontHref: Route;
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
      if (!result.ok) {
        cabinet.fail(result.code);
        return;
      }
      cabinet.setError(undefined);
      cabinet.applySubscription(result.value);
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
      if (!result.ok) {
        cabinet.fail(result.code);
        return;
      }
      cabinet.setError(undefined);
      setResumeAccepted([]);
      cabinet.applySubscription(result.value);
    },
  });
  const quoteChange = useMutation({
    mutationFn: quoteBillingChange,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        cabinet.fail(result.code);
        return;
      }
      completeOperation("change-quote");
      cabinet.setError(undefined);
      setChangeQuote(result.value);
    },
  });
  const confirmChange = useMutation({
    mutationFn: changeBillingOption,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        if (result.code === "quote_expired" || result.code === "quote_changed")
          setChangeQuote(null);
        cabinet.fail(result.code);
        return;
      }
      completeOperation("change");
      cabinet.setError(undefined);
      setChangeQuote(null);
      cabinet.applySubscription(result.value.subscription);
      const paymentUrl = result.value.payment?.paymentUrl ?? null;
      if (paymentUrl !== null) (onNavigate ?? navigate)(paymentUrl);
    },
  });
  const dropChange = useMutation({
    mutationFn: cancelBillingChange,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        cabinet.fail(result.code);
        return;
      }
      cabinet.setError(undefined);
      cabinet.applySubscription(result.value);
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
      onRefresh={cabinet.refresh}
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

function navigate(url: string): void {
  window.location.assign(url);
}
