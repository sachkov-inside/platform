"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  acceptBillingConsents,
  billingErrorMessage,
  useBillingOperations,
  type ChangeQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type PriceSnapshot,
  type SubscriptionView,
} from "@/entities/subscription";

import {
  cancelBillingChange,
  cancelBillingRenewal,
  changeBillingOption,
  changeBillingPaymentMethod,
  quoteBillingChange,
  readCurrentBilling,
  resumeBillingRenewal,
  revokeBillingPaymentMethod,
} from "../api/billing-subscription.browser";
import { BillingCabinetView } from "./billing-cabinet-view.client";

export const currentBillingQueryKey = ["account", "billing"] as const;

export function currentBillingQueryOptions() {
  return {
    queryKey: currentBillingQueryKey,
    queryFn: readCurrentBilling,
    retry: false,
    staleTime: 0,
  };
}

export interface BillingCabinetPanelProps {
  readonly options: readonly PriceSnapshot[];
  readonly resumeDocuments: readonly LegalDocument[];
  readonly storefrontHref: string;
  readonly contactHref: string;
  readonly onNavigate?: (url: string) => void;
}

/**
 * Кабинет держит один источник состояния подписки: каждая команда возвращает новую revision,
 * и она же становится ожидаемой для следующей.
 */
export function BillingCabinetPanel({
  options,
  resumeDocuments,
  storefrontHref,
  contactHref,
  onNavigate,
}: BillingCabinetPanelProps) {
  const queryClient = useQueryClient();
  const query = useQuery(currentBillingQueryOptions());
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [changeQuote, setChangeQuote] = useState<ChangeQuote | null>(null);
  const [resumeAccepted, setResumeAccepted] = useState<
    readonly LegalDocumentKind[]
  >([]);
  const [error, setError] = useState<string>();
  const operationId = useBillingOperations();

  const billing = query.data?.ok === true ? query.data.value : null;
  const subscription = billing?.subscription ?? null;

  function applySubscription(value: SubscriptionView): void {
    queryClient.setQueryData<typeof query.data>(
      currentBillingQueryKey,
      (current) =>
        current?.ok === true
          ? {
              ok: true,
              value: { ...current.value, subscription: value },
            }
          : current,
    );
  }

  function fail(code: Parameters<typeof billingErrorMessage>[0]): void {
    setError(billingErrorMessage(code));
    void query.refetch();
  }

  const cancelRenewal = useMutation({
    mutationFn: cancelBillingRenewal,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        fail(result.code);
        return;
      }
      setError(undefined);
      applySubscription(result.value);
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
        fail(result.code);
        return;
      }
      setError(undefined);
      setResumeAccepted([]);
      applySubscription(result.value);
    },
  });
  const quoteChange = useMutation({
    mutationFn: quoteBillingChange,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        fail(result.code);
        return;
      }
      setError(undefined);
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
        fail(result.code);
        return;
      }
      setError(undefined);
      setChangeQuote(null);
      applySubscription(result.value.subscription);
      const paymentUrl = result.value.payment?.paymentUrl ?? null;
      if (paymentUrl !== null) (onNavigate ?? navigate)(paymentUrl);
    },
  });
  const dropChange = useMutation({
    mutationFn: cancelBillingChange,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        fail(result.code);
        return;
      }
      setError(undefined);
      applySubscription(result.value);
    },
  });
  const changeMethod = useMutation({
    mutationFn: changeBillingPaymentMethod,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        fail(result.code);
        return;
      }
      setError(undefined);
      void query.refetch();
      if (result.value.formUrl !== null)
        (onNavigate ?? navigate)(result.value.formUrl);
    },
  });
  const revokeMethod = useMutation({
    mutationFn: revokeBillingPaymentMethod,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        fail(result.code);
        return;
      }
      setError(undefined);
      applySubscription(result.value);
    },
  });

  const pending =
    cancelRenewal.isPending ||
    resumeRenewal.isPending ||
    quoteChange.isPending ||
    confirmChange.isPending ||
    dropChange.isPending ||
    changeMethod.isPending ||
    revokeMethod.isPending;
  const readFailure = query.data?.ok === false ? query.data.code : undefined;

  return (
    <BillingCabinetView
      changeQuote={changeQuote}
      contactHref={contactHref}
      error={
        error ??
        (readFailure !== undefined && readFailure !== "unauthorized"
          ? billingErrorMessage(readFailure)
          : undefined)
      }
      loading={query.isPending || query.isFetching}
      notices={billing?.notices ?? []}
      onCancelPendingChange={() => {
        if (subscription === null) return;
        setError(undefined);
        dropChange.mutate({
          operationId: operationId("change-cancel", {
            revision: subscription.revision,
          }),
          expectedRevision: subscription.revision,
        });
      }}
      onCancelRenewal={() => {
        if (subscription === null) return;
        setError(undefined);
        cancelRenewal.mutate({
          operationId: operationId("cancel", { revision: subscription.revision }),
          expectedRevision: subscription.revision,
        });
      }}
      onChangeMethod={() => {
        if (subscription === null) return;
        setError(undefined);
        changeMethod.mutate({
          operationId: operationId("method-change", {
            revision: subscription.revision,
          }),
          expectedRevision: subscription.revision,
        });
      }}
      onConfirmChange={() => {
        if (subscription === null || changeQuote === null) return;
        setError(undefined);
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
        setError(undefined);
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
      onRefresh={() => {
        setError(undefined);
        void query.refetch();
      }}
      onResumeRenewal={() => {
        if (subscription === null) return;
        setError(undefined);
        resumeRenewal.mutate({
          expectedRevision: subscription.revision,
          accepted: resumeAccepted,
        });
      }}
      onRevokeMethod={() => {
        if (subscription?.paymentMethod == null) return;
        setError(undefined);
        revokeMethod.mutate({
          operationId: operationId("method-revoke", { revision: subscription.revision }),
          expectedRevision: subscription.revision,
          paymentMethodRef: subscription.paymentMethod.methodRef,
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
      pending={pending}
      resumeAccepted={resumeAccepted}
      resumeDocuments={resumeDocuments}
      selectedOptionId={selectedOptionId}
      sessionExpired={readFailure === "unauthorized"}
      storefrontHref={storefrontHref}
      subscription={subscription}
    />
  );
}

function navigate(url: string): void {
  window.location.assign(url);
}
