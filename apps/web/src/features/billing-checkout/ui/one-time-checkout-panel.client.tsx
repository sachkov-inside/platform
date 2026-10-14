"use client";
import { useId, type Ref } from "react";

import {
  LegalDocumentLinks,
  legalNavigationEntry,
} from "@/entities/legal-document";
import {
  AcceptanceNote,
  billingActionClass,
  checkoutButtonLabel,
  checkoutActionName,
  legalDocumentLabel,
  attemptStateLabel,
  formatKopecks,
  paymentMode,
  promotionLabel,
  preorderDiscount,
  purchaseConsentPolicy,
  type BillingQuote,
  type LegalDocument,
  type PreorderTerms,
  type PriceSnapshot,
  type PurchaseStatus,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";
import { CheckoutEmailField } from "./checkout-email-field.client";

import {
  oneTimeOfferTerms,
  oneTimePriceSharesLine,
  oneTimePurchaseInclusions,
  oneTimeTermsSummary,
} from "../model/one-time-terms";

export interface OneTimeCheckoutPanelProps {
  readonly snapshot: PriceSnapshot;
  readonly quote: BillingQuote | null;
  readonly documents: readonly LegalDocument[];
  readonly email: string;
  readonly accountEmailPresent?: boolean;
  readonly emailError?: string | undefined;
  readonly onEmailChange: (value: string) => void;
  readonly emailInputRef?: Ref<HTMLInputElement>;
  readonly acknowledgeExistingAccess: boolean;
  readonly existingAccess?: boolean;
  readonly legacyBlocked?: boolean;
  readonly pending?: boolean;
  readonly paymentBlocked?: boolean;
  readonly error?: string | undefined;
  readonly purchase: PurchaseStatus | null;
  /** Показывать ли состав покупки: панель строит его из того же снимка, что и сводку условий. */
  readonly showInclusions?: boolean;
  readonly onToggleAcknowledge: () => void;
  readonly onPay: () => void;
  readonly onRefreshStatus: () => void;
  readonly onRetryQuote: () => void;
  /** Покупатель пришёл по ссылке с промокодом, а расчёт скидку по нему не дал. */
  readonly promoRejected?: boolean;
  /** Пока поток набирается: день старта и цена после него, зачёркнутая рядом с ценой. */
  readonly preorder?: PreorderTerms | null;
}

/**
 * Оплата руководства одной страницей: что входит, сколько стоит, куда придёт чек и одна кнопка.
 * Оферта принимается нажатием «Оплатить»: строка под кнопкой говорит об этом, отметок нет.
 * Цена показывается сразу — расчёт сервер сохраняет сам, поэтому отдельного шага «рассчитать»
 * здесь нет. Возврат из банка успехом не считается: состояние приходит от сервера.
 */

/**
 * Название принимаемого документа: оферты покупки и подписки называются по документу, а форму
 * после «Принимаю» даёт каталог раздела.
 */
function documentLabel(document: LegalDocument): string {
  const entry = legalNavigationEntry(document.documentId);
  return (
    entry?.consentLabel ?? entry?.navLabel ?? legalDocumentLabel(document.kind)
  );
}

export function OneTimeCheckoutPanel({
  snapshot,
  quote,
  documents,
  email,
  accountEmailPresent = false,
  emailError,
  onEmailChange,
  emailInputRef,
  acknowledgeExistingAccess,
  existingAccess = false,
  legacyBlocked = false,
  pending = false,
  paymentBlocked = false,
  error,
  purchase,
  showInclusions = false,
  onToggleAcknowledge,
  onPay,
  onRefreshStatus,
  onRetryQuote,
  promoRejected = false,
  preorder = null,
}: OneTimeCheckoutPanelProps) {
  const headingId = useId();
  const termsId = useId();
  const acknowledgeId = useId();
  const conditions = quote?.snapshot ?? snapshot;
  const promotion = promotionLabel(conditions);
  // Зачёркивать имеет смысл только большую цену: скидка по ссылке может опустить и её.
  const afterStart =
    preorder !== null &&
    preorder.priceAfterStartKopecks !== null &&
    preorder.priceAfterStartKopecks > conditions.firstPriceKopecks
      ? preorder.priceAfterStartKopecks
      : null;
  const preorderSaving = preorderDiscount(
    conditions.firstPriceKopecks,
    afterStart,
  );
  const terms = oneTimeOfferTerms(conditions);
  // Состав называет те же сроки, что сводка условий: оба читают снимок сохранённого расчёта, как
  // только он есть. Иначе смена сроков между загрузкой страницы и расчётом развела бы их.
  const shownInclusions = showInclusions
    ? oneTimePurchaseInclusions(conditions)
    : [];
  const priceShares = oneTimePriceSharesLine(
    conditions.firstPriceKopecks,
    terms,
  );
  const { required, applicable } = purchaseConsentPolicy(
    documents,
    paymentMode(conditions),
  );
  const missingRequired = required.filter(
    (kind) => !applicable.some((document) => document.kind === kind),
  );
  const payable =
    quote !== null &&
    missingRequired.length === 0 &&
    !legacyBlocked &&
    (!existingAccess || acknowledgeExistingAccess);

  return (
    <form
      aria-labelledby={headingId}
      className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-7"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (payable && !pending && !paymentBlocked) onPay();
      }}
    >
      <h2 className="sr-only" id={headingId}>
        Оплата продукта
      </h2>

      <div>
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-3xl font-bold tabular-nums">
            {formatKopecks(conditions.firstPriceKopecks)}
          </span>
          {afterStart === null ? null : (
            <s className="text-sm text-muted-foreground">
              <span className="sr-only">Цена после старта: </span>
              {formatKopecks(afterStart)}
            </s>
          )}
          {promotion === undefined && preorderSaving !== null ? (
            <span className="text-sm font-semibold">{preorderSaving}</span>
          ) : null}
          {promotion === undefined ? null : (
            <span className="text-sm font-semibold">{promotion}</span>
          )}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">Разовая оплата</p>
        {promoRejected ? (
          <p className="mt-2 text-sm text-muted-foreground" role="status">
            Скидка по ссылке не применилась.
          </p>
        ) : null}
        {quote === null ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            {pending
              ? "Готовим точные условия…"
              : "Точные условия пока не сохранены."}
          </p>
        ) : null}
      </div>
      {quote === null && !pending ? (
        <Button
          className={`mt-4 ${billingActionClass}`}
          onClick={onRetryQuote}
          type="button"
          variant="outline"
        >
          Обновить условия
        </Button>
      ) : null}

      {accountEmailPresent ? null : (
        <CheckoutEmailField
          value={email}
          error={emailError}
          onChange={onEmailChange}
          inputRef={emailInputRef}
          disabled={pending || paymentBlocked}
        />
      )}

      <details className="mt-5 border-t border-border pt-4 text-sm leading-6">
        <summary className="min-h-11 cursor-pointer font-semibold" id={termsId}>
          Условия и документы покупки
        </summary>
        {shownInclusions.length === 0 ? null : (
          <ul className="mt-2 grid gap-2">
            {shownInclusions.map((item) => (
              <li key={item.kind}>
                {item.title}
                {item.detail === undefined ? "" : `: ${item.detail}`}
              </li>
            ))}
          </ul>
        )}
        <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-muted-foreground">
          {oneTimeTermsSummary(terms).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="mt-2 text-muted-foreground">{priceShares}</p>
        <LegalDocumentLinks
          className="mt-3"
          label="Документы покупки:"
          keys={["purchase", "terms", "contacts", "privacy"]}
        />
      </details>
      {missingRequired.length > 0 ? (
        <p
          className="mt-5 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6"
          role="status"
        >
          Условия продажи ещё не опубликованы, поэтому принять оплату нельзя.
        </p>
      ) : null}

      {existingAccess ? (
        <div className="mt-5 rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6">
          <p className="font-semibold">Этот продукт у вас уже открыт.</p>
          <p className="mt-1 text-muted-foreground">
            Повторная покупка не удваивает право и не продлевает уже открытое.
          </p>
          <label className="mt-3 flex max-sm:min-h-11 items-start gap-3">
            <input
              checked={acknowledgeExistingAccess}
              className="mt-1 size-4 shrink-0 sm:size-5 rounded border-input accent-primary"
              disabled={pending}
              id={acknowledgeId}
              onChange={onToggleAcknowledge}
              type="checkbox"
            />
            <span>Понимаю и всё равно хочу оплатить</span>
          </label>
        </div>
      ) : null}

      <Button
        className={`mt-6 h-auto min-h-12 w-full whitespace-normal text-base ${billingActionClass}`}
        disabled={!payable || pending || paymentBlocked}
        size="lg"
        type="submit"
      >
        {pending ? "Готовим оплату…" : checkoutButtonLabel(conditions)}
      </Button>

      {missingRequired.length > 0 ? null : (
        <AcceptanceNote className="mt-3">
          Нажимая «{checkoutActionName(conditions)}», вы принимаете{" "}
          {applicable
            .filter((document) => required.includes(document.kind))
            .map(documentLabel)
            .join(" и ")}
          .
        </AcceptanceNote>
      )}

      {purchase === null ? null : (
        <div className="mt-6 border-t border-border pt-5 text-sm leading-6">
          <p className="font-semibold">{attemptStateLabel(purchase.state)}</p>
          <p className="mt-1 text-muted-foreground">
            {purchase.access === "ready"
              ? "Доступ открыт."
              : purchase.access === "preparing"
                ? "Оплата подтверждена, открываем доступ."
                : "Доступ откроется после подтверждения оплаты сервером."}
          </p>
          <Button
            className={`mt-3 ${billingActionClass}`}
            disabled={pending}
            onClick={onRefreshStatus}
            type="button"
            variant="outline"
          >
            Проверить состояние
          </Button>
        </div>
      )}

      {error === undefined ? null : (
        <p
          className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6"
          role="alert"
        >
          {error}
        </p>
      )}
    </form>
  );
}
