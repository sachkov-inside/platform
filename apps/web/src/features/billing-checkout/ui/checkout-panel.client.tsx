"use client";
import type { Route } from "next";
import Link from "next/link";
import { useId } from "react";

import { LegalDocumentLinks, legalNavigationEntry } from "@/entities/legal-document";
import {
  billingActionClass,
  ConsentChecklist,
  legalDocumentLabel,
  attemptStateLabel,
  formatBillingDateTime,
  formatKopecks,
  formatMonths,
  paymentMode,
  promotionLabel,
  purchaseConsentPolicy,
  type BillingQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type PriceSnapshot,
  type PurchaseStatus,
  type VerifiedContact,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

export interface CheckoutPanelProps {
  readonly snapshot: PriceSnapshot;
  /** Сохранённый расчёт: точные суммы и срок действия условий. */
  readonly quote: BillingQuote | null;
  readonly documents: readonly LegalDocument[];
  readonly accepted: readonly LegalDocumentKind[];
  readonly contact: VerifiedContact | null;
  readonly contactHref: Route;
  readonly acknowledgeExistingAccess: boolean;
  readonly existingAccess?: boolean;
  readonly legacyBlocked?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly purchase: PurchaseStatus | null;
  readonly onQuote: () => void;
  readonly onToggleDocument: (kind: LegalDocumentKind) => void;
  readonly onToggleAcknowledge: () => void;
  readonly onPay: () => void;
  readonly onRefreshStatus: () => void;
}

/**
 * Оформление покупки: сначала точные условия сервера, затем отдельные согласия, и только
 * потом оплата. Ни один флажок не отмечен заранее, а возврат из банка не считается успехом.
 * Разовая покупка идёт тем же путём, но не обещает ни следующего периода, ни списаний.
 */

/** Название принимаемого документа: оферты покупки и подписки называются по документу. */
function documentLabel(document: LegalDocument): string {
  return legalNavigationEntry(document.documentId)?.navLabel ?? legalDocumentLabel(document.kind);
}

export function CheckoutPanel({
  snapshot,
  quote,
  documents,
  accepted,
  contact,
  contactHref,
  acknowledgeExistingAccess,
  existingAccess = false,
  legacyBlocked = false,
  pending = false,
  error,
  purchase,
  onQuote,
  onToggleDocument,
  onToggleAcknowledge,
  onPay,
  onRefreshStatus,
}: CheckoutPanelProps) {
  const headingId = useId();
  const acknowledgeId = useId();
  const conditions = quote?.snapshot ?? snapshot;
  const promotion = promotionLabel(conditions);
  const mode = paymentMode(conditions);
  const recurring = mode === "subscription";
  const { required, applicable } = purchaseConsentPolicy(documents, mode);
  const missingRequired = required.filter(
    (kind) => !applicable.some((document) => document.kind === kind),
  );
  const consentsAccepted = required.every((kind) => accepted.includes(kind));
  const payable =
    quote !== null &&
    contact !== null &&
    missingRequired.length === 0 &&
    consentsAccepted &&
    !legacyBlocked &&
    (!existingAccess || acknowledgeExistingAccess);

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <h2
        className="text-2xl font-bold tracking-[-0.035em]"
        id={headingId}
      >
        {recurring ? "Оформление подписки" : "Оформление покупки"}
      </h2>

      <dl className="mt-5 grid gap-3 text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">
            {recurring ? "Тариф" : "Покупка"}
          </dt>
          <dd className="min-w-0 font-semibold [overflow-wrap:anywhere]">
            {conditions.offer.name}
          </dd>
        </div>
        {recurring ? (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Период</dt>
            <dd className="font-mono tabular-nums">
              {formatMonths(conditions.paymentOption.months)}
            </dd>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">
            {recurring ? "Первый платёж" : "Стоимость"}
          </dt>
          <dd className="font-mono tabular-nums font-semibold">
            {formatKopecks(conditions.firstPriceKopecks)}
          </dd>
        </div>
        {recurring ? (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Дальше каждый период</dt>
            <dd className="font-mono tabular-nums">
              {formatKopecks(conditions.renewalPriceKopecks)}
            </dd>
          </div>
        ) : null}
        {promotion === undefined ? null : (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Скидка</dt>
            <dd className="font-mono text-action">{promotion}</dd>
          </div>
        )}
      </dl>

      {quote === null ? (
        <>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            Точные суммы и срок действия условий сохраняет сервер. Расчёт нужен
            до согласия и оплаты.
          </p>
          <Button
            className={`mt-4 ${billingActionClass}`}
            disabled={pending}
            onClick={onQuote}
            type="button"
          >
            {pending ? "Считаем…" : "Рассчитать условия"}
          </Button>
        </>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted-foreground">
            Условия действуют до{" "}
            <span className="font-mono">
              {formatBillingDateTime(quote.expiresAt)}
            </span>
            .{" "}
            {recurring
              ? `Следующее списание — через ${formatMonths(conditions.paymentOption.months)} после подтверждения оплаты.`
              : "Это разовый платёж: подписку он не оформляет и списаний по нему не будет."}
          </p>

          {contact === null ? (
            <div className="mt-5 rounded-xl border border-border bg-secondary/50 p-4 text-sm leading-6">
              <p className="font-semibold">Нужен подтверждённый email.</p>
              <p className="mt-1 text-muted-foreground">
                На него придёт чек{recurring ? " и служебные сообщения о подписке" : ""}.
              </p>
              <Link
                className={`mt-3 inline-flex items-center font-semibold text-action underline underline-offset-4 ${billingActionClass}`}
                href={contactHref}
              >
                Подтвердить email
              </Link>
            </div>
          ) : (
            <p className="mt-5 break-words text-sm text-muted-foreground">
              Чек придёт на{" "}
              <span className="font-semibold text-foreground">
                {contact.email}
              </span>
              .
            </p>
          )}

          {missingRequired.length > 0 ? (
            <p className="mt-5 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6" role="status">
              Условия продажи ещё не опубликованы, поэтому принять оплату нельзя.
              Мы включим оформление, как только документы появятся.
            </p>
          ) : (
            <div className="mt-5 border-t border-border pt-5">
              <ConsentChecklist
                accepted={accepted}
                disabled={pending}
                documents={applicable}
                labelFor={documentLabel}
                legend="Согласия перед оплатой"
                markOptional
                namePrefix="consent"
                onToggle={onToggleDocument}
                required={required}
              />
            </div>
          )}

          <LegalDocumentLinks
            className="mt-5"
            label="Документы этой покупки:"
            keys={["subscription", "recurring-consent", "privacy"]}
          />

          {existingAccess ? (
            <div className="mt-5 rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6">
              <p className="font-semibold">
                Часть этого состава у вас уже открыта.
              </p>
              <p className="mt-1 text-muted-foreground">
                {recurring
                  ? "Новая подписка не отменяет и не заменяет действующие права."
                  : "Повторная покупка не удваивает право и не продлевает уже открытое."}
              </p>
              <label className="mt-3 flex items-start gap-3">
                <input
                  checked={acknowledgeExistingAccess}
                  className="mt-1 size-5 shrink-0 rounded border-input accent-primary"
                  disabled={pending}
                  id={acknowledgeId}
                  onChange={onToggleAcknowledge}
                  type="checkbox"
                />
                <span>
                  {recurring
                    ? "Понимаю и хочу оформить подписку"
                    : "Понимаю и всё равно хочу оплатить"}
                </span>
              </label>
            </div>
          ) : null}

          {legacyBlocked ? (
            <p className="mt-5 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6" role="status">
              Ваша прежняя подписка ещё не разобрана. Пока проверка не завершена,
              новое списание не начинаем — доступ по прежнему основанию сохраняется.
            </p>
          ) : (
            <Button
              className={`mt-6 w-full sm:w-auto ${billingActionClass}`}
              disabled={!payable || pending}
              onClick={onPay}
              type="button"
            >
              {pending
                ? "Готовим оплату…"
                : `Оплатить ${formatKopecks(conditions.firstPriceKopecks)}`}
            </Button>
          )}
        </>
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
        <p className="mt-5 rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
