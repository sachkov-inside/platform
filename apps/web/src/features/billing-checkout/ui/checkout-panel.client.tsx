"use client";
import Link from "next/link";
import { useId } from "react";

import {
  ConsentChecklist,
  attemptStateLabel,
  formatBillingDateTime,
  formatKopecks,
  formatMonths,
  promotionLabel,
  requiredConsentKinds,
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
  readonly contactHref: string;
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
 * Оформление подписки: сначала точные условия сервера, затем отдельные согласия, и только
 * потом оплата. Ни один флажок не отмечен заранее, а возврат из банка не считается успехом.
 */
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
  const missingRequired = requiredConsentKinds.filter(
    (kind) => !documents.some((document) => document.kind === kind),
  );
  const consentsAccepted = requiredConsentKinds.every((kind) =>
    accepted.includes(kind),
  );
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
        Оформление подписки
      </h2>

      <dl className="mt-5 grid gap-3 text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Тариф</dt>
          <dd className="min-w-0 font-semibold [overflow-wrap:anywhere]">
            {conditions.offer.name}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Период</dt>
          <dd className="font-mono tabular-nums">
            {formatMonths(conditions.paymentOption.months)}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Первый платёж</dt>
          <dd className="font-mono tabular-nums font-semibold">
            {formatKopecks(conditions.firstPriceKopecks)}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Дальше каждый период</dt>
          <dd className="font-mono tabular-nums">
            {formatKopecks(conditions.renewalPriceKopecks)}
          </dd>
        </div>
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
            className="mt-4 h-auto min-h-11 max-w-full whitespace-normal"
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
            . Следующее списание — через{" "}
            {formatMonths(conditions.paymentOption.months)} после подтверждения
            оплаты.
          </p>

          {contact === null ? (
            <div className="mt-5 rounded-xl border border-border bg-secondary/50 p-4 text-sm leading-6">
              <p className="font-semibold">Нужен подтверждённый email.</p>
              <p className="mt-1 text-muted-foreground">
                На него придут чек и служебные сообщения о подписке.
              </p>
              <Link
                className="mt-3 inline-flex h-auto min-h-11 max-w-full whitespace-normal items-center font-semibold text-action underline underline-offset-4"
                href={{ pathname: contactHref }}
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
                documents={documents}
                legend="Согласия перед оплатой"
                markOptional
                namePrefix="consent"
                onToggle={onToggleDocument}
              />
            </div>
          )}

          {existingAccess ? (
            <div className="mt-5 rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6">
              <p className="font-semibold">
                Часть этого состава у вас уже открыта.
              </p>
              <p className="mt-1 text-muted-foreground">
                Новая подписка не отменяет и не заменяет действующие права.
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
                <span>Понимаю и хочу оформить подписку</span>
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
              className="mt-6 h-auto min-h-11 max-w-full whitespace-normal w-full sm:w-auto"
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
            className="mt-3 h-auto min-h-11 max-w-full whitespace-normal"
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
