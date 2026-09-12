"use client";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  acceptBillingConsents,
  billingErrorMessage,
  type BillingQuote,
  type LegalDocument,
  type LegalDocumentKind,
  paymentMode,
  type PriceSnapshot,
  type PurchaseStatus,
  type VerifiedContact,
} from "@/entities/subscription";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  createBillingQuote,
  readBillingPurchaseStatus,
  startBillingPurchase,
} from "../api/billing-checkout.browser";
import { acceptedPurchaseDocuments, rememberPurchase } from "../model/checkout";
import { CheckoutPanel } from "./checkout-panel.client";
import { OneTimeCheckoutPanel } from "./one-time-checkout-panel.client";

export interface CheckoutFlowProps {
  readonly snapshot: PriceSnapshot;
  readonly contact: VerifiedContact | null;
  readonly documents: readonly LegalDocument[];
  readonly contactHref: Route;
  readonly onPurchase?: (purchase: PurchaseStatus) => void;
  readonly onNavigate?: (paymentUrl: string) => void;
  /** Состав покупки для компактной страницы оплаты: что именно получает покупатель. */
  readonly inclusions?: readonly CheckoutInclusion[];
}

/**
 * Одна строка состава покупки. `kind` называет, о чём она, — срок или содержимое, — и по нему
 * панель выбирает значок. Разбирать для этого подпись было бы гаданием по тексту.
 */
export interface CheckoutInclusion {
  readonly kind: "term" | "composition";
  readonly caption: string;
  readonly detail: string;
  readonly title: string;
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
  inclusions = [],
}: CheckoutFlowProps) {
  const [quote, setQuote] = useState<BillingQuote | null>(null);
  const [accepted, setAccepted] = useState<readonly LegalDocumentKind[]>([]);
  const [acknowledge, setAcknowledge] = useState(false);
  const [existingAccess, setExistingAccess] = useState(false);
  const [legacyBlocked, setLegacyBlocked] = useState(false);
  const [purchase, setPurchase] = useState<PurchaseStatus | null>(null);
  const [error, setError] = useState<string>();
  const { operationId, completeOperation } = useRepeatableOperations();

  const quoteMutation = useMutation({
    mutationFn: createBillingQuote,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        setError(billingErrorMessage(result.code));
        return;
      }
      // Расчёт сохранён и однажды истечёт: пересчёт тех же условий — новая операция.
      completeOperation("quote");
      setError(undefined);
      setQuote(result.value);
      setAccepted([]);
      setExistingAccess(false);
      setLegacyBlocked(false);
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
      const consents = await acceptBillingConsents({
        operationId: operationId("consents", {
          quoteRef: input.quote.quoteRef,
          accepted: input.accepted,
        }),
        contextRef: input.quote.quoteRef,
        documents: acceptedPurchaseDocuments(documents, input.quote, input.accepted),
      });
      if (!consents.ok) return consents;
      const evidenceRefs = consents.value.evidenceRefs;
      return await startBillingPurchase({
        operationId: operationId("purchase", {
          quoteRef: input.quote.quoteRef,
          evidenceRefs,
          acknowledgeExistingAccess: input.acknowledgeExistingAccess,
        }),
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

  const requestQuote = () => {
    setError(undefined);
    quoteMutation.mutate({
      operationId: operationId("quote", {
        paymentOptionId: snapshot.paymentOption.id,
        optionRevision: snapshot.paymentOption.revision,
      }),
      paymentOptionId: snapshot.paymentOption.id,
      optionRevision: snapshot.paymentOption.revision,
    });
  };
  // Разовая покупка показывает цену сразу: отдельный шаг «рассчитать» здесь только мешал бы.
  // Расчёт запрашивается один раз на вариант; повтор того же operationId вернёт тот же расчёт.
  const oneTime = paymentMode(snapshot) === "one_time";
  const requested = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!oneTime || requested.current === snapshot.paymentOption.id) return;
    requested.current = snapshot.paymentOption.id;
    requestQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- расчёт принадлежит выбранному варианту
  }, [oneTime, snapshot.paymentOption.id]);

  const shared = {
    acknowledgeExistingAccess: acknowledge,
    accepted,
    contact,
    contactHref,
    documents,
    error,
    existingAccess,
    legacyBlocked,
    onPay: () => {
      if (quote === null || contact === null) return;
      setError(undefined);
      payMutation.mutate({
        quote,
        contactRevision: contact.revision,
        acknowledgeExistingAccess: acknowledge,
        accepted,
      });
    },
    onRefreshStatus: () => {
      if (purchase === null) return;
      setError(undefined);
      statusMutation.mutate(purchase.purchaseRef);
    },
    onToggleAcknowledge: () => {
      setAcknowledge((value) => !value);
    },
    onToggleDocument: (kind: LegalDocumentKind) => {
      setAccepted((value) =>
        value.includes(kind)
          ? value.filter((entry) => entry !== kind)
          : [...value, kind],
      );
    },
    pending:
      quoteMutation.isPending || payMutation.isPending || statusMutation.isPending,
    purchase,
    quote,
    snapshot,
  } as const;

  return oneTime ? (
    <OneTimeCheckoutPanel {...shared} inclusions={inclusions} onRetryQuote={requestQuote} />
  ) : (
    <CheckoutPanel {...shared} onQuote={requestQuote} />
  );
}

function defaultNavigate(paymentUrl: string): void {
  window.location.assign(paymentUrl);
}
