"use client";
import Link from "next/link";
import type { Route } from "next";

import {
  billingActionClass,
  ConsentChecklist,
  resumeConsentKinds,
  formatBillingDate,
  formatBillingDateTime,
  formatKopecks,
  formatMonths,
  type ChangeQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type PriceSnapshot,
  type SubscriptionView,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

export interface SubscriptionActionsProps {
  readonly subscription: SubscriptionView;
  readonly options: readonly PriceSnapshot[];
  readonly selectedOptionId: string | null;
  readonly changeQuote: ChangeQuote | null;
  readonly resumeDocuments: readonly LegalDocument[];
  readonly resumeAccepted: readonly LegalDocumentKind[];
  readonly pending: boolean;
  readonly storefrontHref: Route;
  readonly onCancelRenewal: () => void;
  readonly onResumeRenewal: () => void;
  readonly onToggleResumeDocument: (kind: LegalDocumentKind) => void;
  readonly onSelectOption: (paymentOptionId: string) => void;
  readonly onQuoteChange: () => void;
  readonly onConfirmChange: () => void;
}

/**
 * Управление подпиской: отмена и возобновление продления и смена варианта. Возобновление
 * требует нового явного согласия на списания.
 */
export function SubscriptionActions({
  subscription,
  options,
  selectedOptionId,
  changeQuote,
  resumeDocuments,
  resumeAccepted,
  pending,
  storefrontHref,
  onCancelRenewal,
  onResumeRenewal,
  onToggleResumeDocument,
  onSelectOption,
  onQuoteChange,
  onConfirmChange,
}: SubscriptionActionsProps) {
  return (
      <section
        aria-labelledby="billing-actions"
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <h2
          className="text-xl font-semibold"
          id="billing-actions"
        >
          Управление подпиской
        </h2>

        {subscription.state === "active" ? (
          <div className="mt-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Отмена останавливает будущие списания и сохраняет оплаченный
              срок до {formatBillingDate(subscription.paidUntil)}.
            </p>
            <Button
              className={`mt-3 ${billingActionClass}`}
              disabled={pending}
              onClick={onCancelRenewal}
              type="button"
              variant="outline"
            >
              Отменить продление
            </Button>
          </div>
        ) : subscription.state === "canceled" ? (
          <div className="mt-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Возобновить можно внутри оплаченного срока и на прежних
              условиях. Нужно новое явное согласие на списания.
            </p>
            {resumeDocuments.length === 0 ? (
              <p className="mt-3 text-sm" role="status">
                Документы согласия ещё не опубликованы, поэтому возобновить
                списания нельзя.
              </p>
            ) : (
              <div className="mt-3">
                <ConsentChecklist
                  accepted={resumeAccepted}
                  disabled={pending}
                  documents={resumeDocuments}
                  legend="Согласие на списания"
                  namePrefix="resume-consent"
                  onToggle={onToggleResumeDocument}
                  required={resumeConsentKinds}
                />
              </div>
            )}
            <Button
              className={`mt-3 ${billingActionClass}`}
              disabled={pending || !resumeAccepted.includes("recurring")}
              onClick={onResumeRenewal}
              type="button"
            >
              Возобновить списания
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Подписка завершена. Новый срок начинается новой покупкой на{" "}
            <Link
              className="text-action underline underline-offset-4"
              href={storefrontHref}
            >
              витрине
            </Link>
            .
          </p>
        )}

        {subscription.state === "ended" || options.length === 0 ? null : (
          <div className="mt-6 border-t border-border pt-5">
            <h3 className="text-base font-semibold">Сменить тариф</h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Повышение сохраняет срок и требует доплаты. Понижение и другая
              длительность вступают в силу следующим периодом.
            </p>
            <fieldset className="mt-3">
              <legend className="sr-only">Варианты оплаты</legend>
              <ul className="grid gap-2">
                {options.map((option) => (
                  <li key={option.paymentOption.id}>
                    <label className="flex items-start gap-3 text-sm leading-6">
                      <input
                        checked={
                          selectedOptionId === option.paymentOption.id
                        }
                        className="mt-1 size-5 shrink-0 accent-primary"
                        disabled={pending}
                        name="billing-change-option"
                        onChange={() => {
                          onSelectOption(option.paymentOption.id);
                        }}
                        type="radio"
                        value={option.paymentOption.id}
                      />
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                        {option.offer.name} ·{" "}
                        {formatMonths(option.paymentOption.months)} ·{" "}
                        {formatKopecks(option.renewalPriceKopecks)}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            {changeQuote === null ? (
              <Button
                className={`mt-3 ${billingActionClass}`}
                disabled={pending || selectedOptionId === null}
                onClick={onQuoteChange}
                type="button"
                variant="outline"
              >
                Рассчитать изменение
              </Button>
            ) : (
              <div className="mt-3 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6">
                {changeQuote.plan.kind === "upgrade" ? (
                  <p>
                    Доплата сейчас:{" "}
                    <span className="font-mono tabular-nums font-semibold">
                      {formatKopecks(changeQuote.plan.topUpKopecks)}
                    </span>
                    . Срок и длительность сохраняются.
                  </p>
                ) : (
                  <p>
                    Вступит в силу{" "}
                    {formatBillingDate(changeQuote.plan.effectiveAt)}. Цена
                    следующего периода:{" "}
                    <span className="font-mono tabular-nums font-semibold">
                      {formatKopecks(changeQuote.plan.nextPriceKopecks)}
                    </span>
                    .
                  </p>
                )}
                <p className="mt-1 text-muted-foreground">
                  Расчёт действует до{" "}
                  {formatBillingDateTime(changeQuote.expiresAt)}.
                </p>
                <Button
                  className={`mt-3 ${billingActionClass}`}
                  disabled={pending}
                  onClick={onConfirmChange}
                  type="button"
                >
                  Подтвердить изменение
                </Button>
              </div>
            )}
          </div>
        )}

      </section>
  );
}
