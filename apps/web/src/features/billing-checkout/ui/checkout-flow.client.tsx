"use client";
import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  acceptBillingConsents,
  billingErrorMessage,
  type BillingQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type PriceSnapshot,
  type PurchaseStatus,
  type VerifiedContact,
} from "@/entities/subscription";

import {
  createBillingQuote,
  readBillingPurchaseStatus,
  startBillingPurchase,
} from "../api/billing-checkout.browser";
import { rememberPurchase } from "../model/checkout";
import { CheckoutPanel } from "./checkout-panel.client";

export interface CheckoutFlowProps {
  readonly snapshot: PriceSnapshot;
  readonly contact: VerifiedContact | null;
  readonly documents: readonly LegalDocument[];
  readonly contactHref: string;
  readonly onPurchase?: (purchase: PurchaseStatus) => void;
  readonly onNavigate?: (paymentUrl: string) => void;
}

/**
 * Держит одну попытку покупки: тот же `operationId` повторяется, пока не изменилась нагрузка,
 * поэтому повтор после сбоя присоединяется к начатой операции, а не создаёт вторую.
 */
export function CheckoutFlow({
  snapshot,
  contact,
  documents,
  contactHref,
  onPurchase,
  onNavigate,
}: CheckoutFlowProps) {
  const [quote, setQuote] = useState<BillingQuote | null>(null);
  const [accepted, setAccepted] = useState<readonly LegalDocumentKind[]>([]);
  const [acknowledge, setAcknowledge] = useState(false);
  const [existingAccess, setExistingAccess] = useState(false);
  const [legacyBlocked, setLegacyBlocked] = useState(false);
  const [purchase, setPurchase] = useState<PurchaseStatus | null>(null);
  const [error, setError] = useState<string>();
  const quoteOperation = useRef<{ key: string; operationId: string } | null>(null);
  const consentOperation = useRef<{ key: string; operationId: string } | null>(null);
  const purchaseOperation = useRef<{ key: string; operationId: string } | null>(null);

  function operationId(
    slot: { current: { key: string; operationId: string } | null },
    key: string,
  ): string {
    if (slot.current === null || slot.current.key !== key)
      slot.current = { key, operationId: crypto.randomUUID() };
    return slot.current.operationId;
  }

  const quoteMutation = useMutation({
    mutationFn: createBillingQuote,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      setError(undefined);
      setQuote(result.value);
      setAccepted([]);
      setExistingAccess(false);
      setLegacyBlocked(false);
      consentOperation.current = null;
      purchaseOperation.current = null;
    },
  });

  const payMutation = useMutation({
    retry: false,
    mutationFn: async (input: {
      readonly quote: BillingQuote;
      readonly contactRevision: number;
      readonly acknowledgeExistingAccess: boolean;
      readonly accepted: readonly LegalDocumentKind[];
    }) => {
      const selected = documents.filter((document) =>
        input.accepted.includes(document.kind),
      );
      const consents = await acceptBillingConsents({
        operationId: operationId(
          consentOperation,
          `${input.quote.quoteRef}:${input.accepted.join(",")}`,
        ),
        contextRef: input.quote.quoteRef,
        documents: selected.map((document) => ({
          kind: document.kind,
          documentId: document.documentId,
          version: document.version,
          digest: document.digest,
        })),
      });
      if (!consents.ok) return consents;
      const evidenceRefs = consents.value.evidenceRefs;
      return await startBillingPurchase({
        operationId: operationId(
          purchaseOperation,
          `${input.quote.quoteRef}:${evidenceRefs.join(",")}:${String(input.acknowledgeExistingAccess)}`,
        ),
        quoteRef: input.quote.quoteRef,
        contactRevision: input.contactRevision,
        consentEvidenceRefs: [...evidenceRefs],
        acknowledgeExistingAccess: input.acknowledgeExistingAccess,
      });
    },
    onSuccess: (result) => {
      if (!result.ok) {
        if (result.code === "existing_access") setExistingAccess(true);
        if (result.code === "legacy_review_required") setLegacyBlocked(true);
        if (result.code === "quote_expired" || result.code === "quote_changed")
          setQuote(null);
        setError(billingErrorMessage(result.code));
        return;
      }
      setError(undefined);
      setPurchase(result.value);
      onPurchase?.(result.value);
      rememberPurchase(result.value.purchaseRef);
      if (result.value.paymentUrl !== null)
        (onNavigate ?? defaultNavigate)(result.value.paymentUrl);
    },
  });

  const statusMutation = useMutation({
    mutationFn: readBillingPurchaseStatus,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      setError(undefined);
      setPurchase(result.value);
      onPurchase?.(result.value);
    },
  });

  return (
    <CheckoutPanel
      acknowledgeExistingAccess={acknowledge}
      accepted={accepted}
      contact={contact}
      contactHref={contactHref}
      documents={documents}
      error={error}
      existingAccess={existingAccess}
      legacyBlocked={legacyBlocked}
      onPay={() => {
        if (quote === null || contact === null) return;
        setError(undefined);
        payMutation.mutate({
          quote,
          contactRevision: contact.revision,
          acknowledgeExistingAccess: acknowledge,
          accepted,
        });
      }}
      onQuote={() => {
        setError(undefined);
        quoteMutation.mutate({
          operationId: operationId(
            quoteOperation,
            `${snapshot.paymentOption.id}:${String(snapshot.paymentOption.revision)}`,
          ),
          paymentOptionId: snapshot.paymentOption.id,
          optionRevision: snapshot.paymentOption.revision,
        });
      }}
      onRefreshStatus={() => {
        if (purchase === null) return;
        setError(undefined);
        statusMutation.mutate(purchase.purchaseRef);
      }}
      onToggleAcknowledge={() => {
        setAcknowledge((value) => !value);
      }}
      onToggleDocument={(kind) => {
        setAccepted((value) =>
          value.includes(kind)
            ? value.filter((entry) => entry !== kind)
            : [...value, kind],
        );
      }}
      pending={
        quoteMutation.isPending ||
        payMutation.isPending ||
        statusMutation.isPending
      }
      purchase={purchase}
      quote={quote}
      snapshot={snapshot}
    />
  );
}

function defaultNavigate(paymentUrl: string): void {
  window.location.assign(paymentUrl);
}
