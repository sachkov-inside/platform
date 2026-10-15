"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import {
  acceptBillingConsents,
  billingErrorMessage,
  checkoutButtonLabel,
  renewalTermsAtCheckout,
  type BillingQuote,
  type LegalDocument,
  paymentMode,
  type PreorderTerms,
  type PriceSnapshot,
  type PurchaseStatus,
  type VerifiedContact,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { useRepeatableOperations } from "@/shared/lib/repeatable-operations.client";

import {
  createBillingQuote,
  readBillingPurchaseStatus,
  startBillingPurchase,
} from "../api/billing-checkout.browser";
import {
  acceptedPurchaseDocuments,
  checkoutEmailSchema,
  rememberPurchase,
  type QuoteInput,
  type PurchaseInput,
} from "../model/checkout";
import { CheckoutPanel } from "./checkout-panel.client";
import { OneTimeCheckoutPanel } from "./one-time-checkout-panel.client";

export interface CheckoutFlowProps {
  readonly snapshot: PriceSnapshot;
  readonly contact: VerifiedContact | null;
  readonly documents: readonly LegalDocument[];
  readonly initialEmail?: string | undefined;
  readonly onPurchase?: (purchase: PurchaseStatus) => void;
  readonly onNavigate?: (paymentUrl: string) => void;
  /** Показывать ли состав разовой покупки: его строит сама панель из снимка условий. */
  readonly showInclusions?: boolean;
  /**
   * Сервер не принял согласие, потому что действует другая редакция. Владелец документов
   * перечитывает их, чтобы покупатель увидел и принял действующую.
   */
  readonly onDocumentsChanged?: () => void;
  /** Промокод персональной ссылки владельца: расчёт применяет его, если код действует. */
  readonly promoCode?: string;
  /** Пока поток набирается: день старта и цена после него для разовой оплаты. */
  readonly preorder?: PreorderTerms | null;
}

interface CheckoutSelection {
  readonly key: string;
  readonly identity: object;
  readonly quote: BillingQuote | null;
  readonly acknowledge: boolean;
  readonly existingAccess: boolean;
  readonly legacyBlocked: boolean;
  readonly error: string | undefined;
}

interface PurchaseAttempt {
  readonly command: PurchaseInput;
  readonly identity: object;
  readonly snapshot: PriceSnapshot;
  readonly email: string;
}

type PaymentRequest =
  | { readonly retry: PurchaseAttempt }
  | {
      readonly quote: BillingQuote;
      readonly identity: object;
      readonly email: string;
      readonly documents: readonly LegalDocument[];
      readonly acknowledgeExistingAccess: boolean;
    };

function newSelection(key: string): CheckoutSelection {
  return {
    key,
    identity: {},
    quote: null,
    acknowledge: false,
    existingAccess: false,
    legacyBlocked: false,
    error: undefined,
  };
}

/** Расчёт принадлежит выбранным условиям; команда оплаты переживает смену выбора. */
export function CheckoutFlow({
  snapshot,
  contact,
  documents,
  initialEmail,
  onPurchase,
  onNavigate,
  showInclusions = false,
  onDocumentsChanged,
  promoCode,
  preorder = null,
}: CheckoutFlowProps) {
  const selectionKey = JSON.stringify([
    snapshot.paymentOption.id,
    snapshot.paymentOption.revision,
    paymentMode(snapshot),
    promoCode,
    snapshot.individualPayment?.linkId,
  ]);
  const [selection, setSelection] = useState(() => newSelection(selectionKey));
  // Сбрасываем до commit: кнопка не получает старый расчёт даже на один рендер.
  if (selection.key !== selectionKey) setSelection(newSelection(selectionKey));
  const { quote, acknowledge, existingAccess, legacyBlocked, error } =
    selection;
  const updateSelection = (
    identity: object,
    patch: Partial<Omit<CheckoutSelection, "key" | "identity">>,
  ) => {
    setSelection((current) =>
      current.identity === identity ? { ...current, ...patch } : current,
    );
  };
  const [attempt, setAttempt] = useState<PurchaseAttempt | null>(null);
  const [paymentError, setPaymentError] = useState<string>();
  const [editedEmail, setEditedEmail] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string>();
  const emailInputRef = useRef<HTMLInputElement>(null);
  const email = initialEmail ?? editedEmail ?? contact?.email ?? "";
  const [purchase, setPurchase] = useState<PurchaseStatus | null>(null);
  const { operationId, completeOperation } = useRepeatableOperations();

  const quoteMutation = useMutation({
    mutationFn: ({
      input,
    }: {
      readonly input: QuoteInput;
      readonly identity: object;
    }) => createBillingQuote(input),
    retry: false,
    onSuccess: (result, request) => {
      if (!result.ok) {
        updateSelection(request.identity, {
          error:
            snapshot.individualPayment !== undefined &&
            result.code === "reservation_conflict"
              ? "По этой ссылке уже началась или завершилась покупка. Обновите страницу."
              : billingErrorMessage(result.code),
        });
        return;
      }
      // Расчёт сохранён и однажды истечёт: пересчёт тех же условий — новая операция.
      completeOperation("quote");
      updateSelection(request.identity, {
        error: undefined,
        quote: result.value,
        existingAccess: false,
        legacyBlocked: false,
      });
    },
  });

  const payMutation = useMutation({
    retry: false,
    mutationFn: async (input: PaymentRequest) => {
      if ("retry" in input) return startBillingPurchase(input.retry.command);
      // Нажатие кнопки оплаты принимает документы этой покупки; журнал запишет подпись кнопки.
      const acceptedDocuments = acceptedPurchaseDocuments(
        input.documents,
        input.quote,
      );
      const recurring = paymentMode(input.quote.snapshot) === "subscription";
      // Редакции входят в нагрузку: согласие на новую редакцию — новая операция, а не повтор
      // прежней, которую сервер иначе отверг бы как ту же операцию с другими данными.
      const consents = await acceptBillingConsents({
        operationId: operationId("consents", {
          quoteRef: input.quote.quoteRef,
          documents: acceptedDocuments,
        }),
        contextRef: input.quote.quoteRef,
        screen: "checkout",
        buttonLabel: checkoutButtonLabel(input.quote.snapshot),
        ...(recurring
          ? { shownTerms: renewalTermsAtCheckout(input.quote) }
          : {}),
        documents: acceptedDocuments,
      });
      if (!consents.ok) return consents;
      const payload = {
        quoteRef: input.quote.quoteRef,
        email: input.email,
        consentEvidenceRefs: [...consents.value.evidenceRefs],
        acknowledgeExistingAccess: input.acknowledgeExistingAccess,
      };
      const command = {
        operationId: operationId("purchase", payload),
        ...payload,
      };
      // Сохраняем до HTTP: потерянный ответ не даёт права заменить команду новым выбором.
      setAttempt({
        command,
        identity: input.identity,
        snapshot: input.quote.snapshot,
        email: input.email,
      });
      return startBillingPurchase(command);
    },
    onSuccess: (result, request) => {
      const identity =
        "retry" in request ? request.retry.identity : request.identity;
      if (!result.ok) {
        // method_unavailable приходит до чтения receipt и не доказывает отсутствие покупки.
        if (
          result.code !== "unavailable" &&
          result.code !== "dependency_unavailable" &&
          result.code !== "provider_unavailable" &&
          result.code !== "unauthorized" &&
          result.code !== "method_unavailable"
        ) {
          setAttempt(null);
          completeOperation("purchase");
        }
        setPaymentError(billingErrorMessage(result.code));
        if (result.code === "existing_access")
          updateSelection(identity, { existingAccess: true });
        if (result.code === "legacy_review_required")
          updateSelection(identity, { legacyBlocked: true });
        if (result.code === "quote_expired" || result.code === "quote_changed")
          updateSelection(identity, { quote: null });
        // Отказ по согласию значит, что принятая нажатием редакция больше не действует:
        // документы перечитываются, и следующее нажатие примет действующую.
        if (
          result.code === "document_changed" ||
          result.code === "consent_required"
        ) {
          onDocumentsChanged?.();
        }
        return;
      }
      const waitingWithoutForm =
        result.value.paymentUrl === null &&
        result.value.state !== "confirmed" &&
        result.value.state !== "failed";
      // Потерянный URL не восстанавливается GetState: сохраняем команду до исхода банка.
      if (!waitingWithoutForm) {
        setAttempt(null);
        completeOperation("purchase");
      }
      setPaymentError(
        waitingWithoutForm
          ? "Форма оплаты пока недоступна. Повторите проверку состояния — новая оплата не создаётся."
          : undefined,
      );
      updateSelection(identity, { error: undefined });
      setPurchase(result.value);
      onPurchase?.(result.value);
      rememberPurchase(result.value.purchaseRef);
      if (result.value.paymentUrl !== null)
        (onNavigate ?? defaultNavigate)(result.value.paymentUrl);
      else if (result.value.state === "confirmed")
        (onNavigate ?? defaultNavigate)(
          snapshot.individualPayment === undefined
            ? "/payment/return"
            : `/payment/links/${snapshot.individualPayment.linkId}?purchaseRef=${result.value.purchaseRef}`,
        );
      else if (
        result.value.state === "failed" &&
        selection.identity === identity
      )
        requestQuote();
    },
  });

  const statusMutation = useMutation({
    mutationFn: readBillingPurchaseStatus,
    retry: false,
    onSuccess: (result) => {
      if (!result.ok) {
        updateSelection(selection.identity, {
          error:
            snapshot.individualPayment !== undefined &&
            result.code === "reservation_conflict"
              ? "По этой ссылке уже началась или завершилась покупка. Обновите страницу."
              : billingErrorMessage(result.code),
        });
        return;
      }
      updateSelection(selection.identity, { error: undefined });
      setPurchase(result.value);
      onPurchase?.(result.value);
      if (
        result.value.state === "failed" ||
        result.value.state === "confirmed"
      ) {
        setAttempt(null);
        setPaymentError(undefined);
        completeOperation("purchase");
        if (result.value.state === "failed") requestQuote();
        else
          (onNavigate ?? defaultNavigate)(
            snapshot.individualPayment === undefined
              ? "/payment/return"
              : `/payment/links/${snapshot.individualPayment.linkId}?purchaseRef=${result.value.purchaseRef}`,
          );
      }
    },
  });

  const requestQuote = () => {
    updateSelection(selection.identity, { error: undefined });
    const input = {
      paymentOptionId: snapshot.paymentOption.id,
      optionRevision: snapshot.paymentOption.revision,
      ...(snapshot.individualPayment === undefined
        ? {}
        : { paymentLinkId: snapshot.individualPayment.linkId }),
      ...(promoCode === undefined ? {} : { promoCode }),
    };
    quoteMutation.mutate({
      identity: selection.identity,
      input: { operationId: operationId("quote", input), ...input },
    });
  };
  // Разовая покупка рассчитывается автоматически; подписка сохраняет явный шаг расчёта.
  const oneTime = paymentMode(snapshot) === "one_time";
  useEffect(() => {
    if (oneTime) requestQuote();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- новая identity означает новые выбранные условия
  }, [oneTime, selection.identity]);

  const shared = {
    acknowledgeExistingAccess: acknowledge,
    email,
    emailError,
    emailInputRef,
    accountEmailPresent: initialEmail !== undefined,
    onEmailChange: (value: string) => {
      setEditedEmail(value);
      setEmailError(undefined);
    },
    documents,
    error,
    existingAccess,
    legacyBlocked,
    onPay: () => {
      if (quote === null || attempt !== null || payMutation.isPending) return;
      const address = checkoutEmailSchema.safeParse(email);
      if (!address.success) {
        setEmailError(
          email.trim() === ""
            ? "Введите email, чтобы получить чек."
            : "Проверьте email: например, name@example.com.",
        );
        emailInputRef.current?.focus();
        return;
      }
      setEmailError(undefined);
      updateSelection(selection.identity, { error: undefined });
      setPaymentError(undefined);
      payMutation.mutate({
        quote,
        identity: selection.identity,
        email: address.data,
        documents,
        acknowledgeExistingAccess: acknowledge,
      });
    },
    onRefreshStatus: () => {
      if (purchase === null) return;
      updateSelection(selection.identity, { error: undefined });
      statusMutation.mutate(purchase.purchaseRef);
    },
    onToggleAcknowledge: () => {
      updateSelection(selection.identity, { acknowledge: !acknowledge });
    },
    pending:
      (quoteMutation.isPending &&
        quoteMutation.variables.identity === selection.identity) ||
      payMutation.isPending ||
      statusMutation.isPending,
    purchase,
    paymentBlocked: attempt !== null,
    quote,
    snapshot,
  } as const;

  // Сервер не говорит, почему код не подошёл: истёк, израсходован или не относится к этому
  // варианту. Покупатель узнаёт главное — цена без скидки по ссылке.
  const promoRejected =
    promoCode !== undefined && quote?.snapshot.promotion === null;

  const panel = oneTime ? (
    <OneTimeCheckoutPanel
      {...shared}
      preorder={preorder}
      showInclusions={showInclusions}
      onRetryQuote={requestQuote}
      promoRejected={promoRejected}
    />
  ) : (
    <CheckoutPanel {...shared} onQuote={requestQuote} />
  );
  return (
    <>
      {panel}
      {attempt === null ? null : (
        <section
          aria-label="Повтор первоначальной покупки"
          className="mt-5 rounded-xl border border-border p-4 text-sm leading-6"
        >
          <p>
            Получаем результат первоначальной покупки:{" "}
            {attempt.snapshot.offer.name}.{" "}
            {checkoutButtonLabel(attempt.snapshot)}. Чек на {attempt.email}.
          </p>
          <p>
            Если ответ потерялся, повтор сохранённых условий восстановит эту
            покупку.
          </p>
          <Button
            className="mt-3"
            disabled={payMutation.isPending}
            onClick={() => {
              setPaymentError(undefined);
              payMutation.mutate({ retry: attempt });
            }}
            type="button"
            variant="outline"
          >
            Повторить первоначальную покупку
          </Button>
        </section>
      )}
      {paymentError === undefined ? null : (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
        >
          {paymentError}
        </p>
      )}
    </>
  );
}

function defaultNavigate(paymentUrl: string): void {
  window.location.assign(paymentUrl);
}
