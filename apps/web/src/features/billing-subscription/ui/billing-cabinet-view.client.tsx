"use client";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  attemptStateLabel,
  benefitLines,
  formatBillingDate,
  formatBillingDateTime,
  formatKopecks,
  formatMonths,
  legalDocumentLabel,
  noticeLabel,
  subscriptionStateLabel,
  type ChangeQuote,
  type LegalDocument,
  type LegalDocumentKind,
  type NoticeView,
  type PriceSnapshot,
  type SubscriptionView,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

export interface BillingCabinetViewProps {
  readonly subscription: SubscriptionView | null;
  readonly notices: readonly NoticeView[];
  /** Каталог для смены варианта: приходит с той же витрины, что и первая покупка. */
  readonly options: readonly PriceSnapshot[];
  readonly selectedOptionId: string | null;
  readonly changeQuote: ChangeQuote | null;
  readonly resumeDocuments: readonly LegalDocument[];
  readonly resumeAccepted: readonly LegalDocumentKind[];
  readonly loading?: boolean;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly sessionExpired?: boolean;
  readonly storefrontHref: string;
  readonly contactHref: string;
  readonly onRefresh: () => void;
  readonly onCancelRenewal: () => void;
  readonly onResumeRenewal: () => void;
  readonly onToggleResumeDocument: (kind: LegalDocumentKind) => void;
  readonly onSelectOption: (paymentOptionId: string) => void;
  readonly onQuoteChange: () => void;
  readonly onConfirmChange: () => void;
  readonly onCancelPendingChange: () => void;
  readonly onChangeMethod: () => void;
  readonly onRevokeMethod: () => void;
}

/**
 * Платёжный кабинет: что уже доступно, по какому основанию и до какого срока. Банковское
 * состояние попытки, готовность доступа и расписание списаний остаются разными фактами.
 */
export function BillingCabinetView({
  subscription,
  notices,
  options,
  selectedOptionId,
  changeQuote,
  resumeDocuments,
  resumeAccepted,
  loading = false,
  pending = false,
  error,
  sessionExpired = false,
  storefrontHref,
  contactHref,
  onRefresh,
  onCancelRenewal,
  onResumeRenewal,
  onToggleResumeDocument,
  onSelectOption,
  onQuoteChange,
  onConfirmChange,
  onCancelPendingChange,
  onChangeMethod,
  onRevokeMethod,
}: BillingCabinetViewProps) {
  if (sessionExpired) {
    return (
      <section className="mx-auto grid max-w-3xl gap-5">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em]">
          Платёжный кабинет
        </h1>
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <p className="text-sm">Войдите, чтобы увидеть свою подписку.</p>
          <form action="/auth/sign-in" className="mt-4" method="post">
            <input name="returnTo" type="hidden" value="/account/subscription" />
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" type="submit">
              Войти
            </Button>
          </form>
        </div>
      </section>
    );
  }

  const renewal =
    subscription === null
      ? null
      : (subscription.pendingChange?.snapshot.renewalPriceKopecks ??
        subscription.snapshot.renewalPriceKopecks);

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header className="grid gap-2">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em]">
          Платёжный кабинет
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Здесь видно, что уже доступно, по какому основанию и до какого срока.
        </p>
      </header>

      {loading && subscription === null ? (
        <p role="status">Загружаем подписку…</p>
      ) : subscription === null ? (
        <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <h2 className="text-xl font-semibold">Действующей подписки нет</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Ранее выданные права остаются в силе на своих условиях: подписка их
            не заменяет.
          </p>
          <Link
            className="mt-4 inline-flex h-auto min-h-11 max-w-full whitespace-normal items-center font-semibold text-action underline underline-offset-4"
            href={{ pathname: storefrontHref }}
          >
            Посмотреть тарифы
          </Link>
        </section>
      ) : (
        <>
          <section
            aria-labelledby="billing-plan"
            className="rounded-2xl border border-border bg-card p-6 shadow-card"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              <h2
                className="min-w-0 text-2xl font-bold tracking-[-0.035em] [overflow-wrap:anywhere]"
                id="billing-plan"
              >
                {subscription.snapshot.offer.name}
              </h2>
              <p className="inline-flex min-h-7 items-center rounded-full bg-secondary px-3 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
                {subscriptionStateLabel(subscription.state)}
              </p>
            </div>

            <ul className="mt-4 grid gap-2 text-sm leading-6">
              {benefitLines(
                subscription.snapshot.offer,
                subscription.snapshot.paymentOption.months,
              ).map((line) => (
                <li className="flex flex-wrap gap-x-2" key={line.capability}>
                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                    {line.label}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {line.term}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="mt-5 grid gap-3 border-t border-border pt-5 text-sm">
              <Row label="Оплачено до">
                <span className="font-mono tabular-nums">
                  {formatBillingDate(subscription.paidUntil)}
                </span>
              </Row>
              <Row label="Текущий период">
                <span className="font-mono tabular-nums">
                  {formatBillingDate(subscription.periodStartsAt)} —{" "}
                  {formatBillingDate(subscription.paidUntil)}
                </span>
              </Row>
              <Row label="Сумма периода">
                <span className="font-mono tabular-nums">
                  {formatKopecks(subscription.periodAmountKopecks)}
                </span>
              </Row>
              <Row label="Следующее списание">
                {subscription.state === "active" && renewal !== null ? (
                  <span className="font-mono tabular-nums">
                    {formatBillingDate(subscription.paidUntil)} ·{" "}
                    {formatKopecks(renewal)}
                  </span>
                ) : (
                  <span>Списаний больше не будет</span>
                )}
              </Row>
              <Row label="Способ оплаты">
                {subscription.paymentMethod === null ? (
                  <span>Не сохранён</span>
                ) : subscription.paymentMethod.revoked ? (
                  <span>Отозван</span>
                ) : (
                  <span>Сохранён</span>
                )}
              </Row>
              <Row label="Ссылка для поддержки">
                <span className="font-mono text-xs [overflow-wrap:anywhere]">
                  {subscription.subscriptionRef}
                </span>
              </Row>
            </dl>

            {subscription.inFlightPayment === null ? null : (
              <p className="mt-4 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6" role="status">
                Незавершённая операция:{" "}
                {attemptStateLabel(subscription.inFlightPayment.state)}. Новую
                оплату начинать не нужно.
              </p>
            )}

            {subscription.pendingMethodChange === null ? null : (
              <p className="mt-4 rounded-xl border border-border bg-muted/50 p-4 text-sm leading-6">
                Начата привязка нового способа оплаты.{" "}
                {subscription.pendingMethodChange.formUrl === null ? (
                  "Ждём результат банка."
                ) : (
                  <a
                    className="text-action underline underline-offset-4"
                    href={subscription.pendingMethodChange.formUrl}
                    rel="noreferrer"
                  >
                    Продолжить в банке
                  </a>
                )}
              </p>
            )}

            {subscription.pendingChange === null ? null : (
              <div className="mt-4 rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm leading-6">
                <p className="font-semibold">
                  Со следующего периода —{" "}
                  {subscription.pendingChange.snapshot.offer.name}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Согласовано{" "}
                  {formatBillingDateTime(subscription.pendingChange.acceptedAt)}.
                  Цена следующего периода:{" "}
                  {formatKopecks(
                    subscription.pendingChange.snapshot.renewalPriceKopecks,
                  )}
                  .
                </p>
                <Button
                  className="mt-3 h-auto min-h-11 max-w-full whitespace-normal"
                  disabled={pending}
                  onClick={onCancelPendingChange}
                  type="button"
                  variant="outline"
                >
                  Отменить изменение
                </Button>
              </div>
            )}
          </section>

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
                  className="mt-3 h-auto min-h-11 max-w-full whitespace-normal"
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
                  <ul className="mt-3 grid gap-2">
                    {resumeDocuments.map((document) => (
                      <li key={`${document.kind}:${document.documentId}`}>
                        <label className="flex items-start gap-3 text-sm leading-6">
                          <input
                            checked={resumeAccepted.includes(document.kind)}
                            className="mt-1 size-5 shrink-0 rounded border-input accent-primary"
                            disabled={pending}
                            name={`resume-consent-${document.kind}`}
                            onChange={() => {
                              onToggleResumeDocument(document.kind);
                            }}
                            type="checkbox"
                          />
                          <span className="min-w-0">
                            Принимаю{" "}
                            <a
                              className="text-action underline underline-offset-4"
                              href={document.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {legalDocumentLabel(document.kind)}
                            </a>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  className="mt-3 h-auto min-h-11 max-w-full whitespace-normal"
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
                  href={{ pathname: storefrontHref }}
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
                    className="mt-3 h-auto min-h-11 max-w-full whitespace-normal"
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
                      className="mt-3 h-auto min-h-11 max-w-full whitespace-normal"
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

            <div className="mt-6 border-t border-border pt-5">
              <h3 className="text-base font-semibold">Способ оплаты</h3>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  className="h-auto min-h-11 max-w-full whitespace-normal"
                  disabled={pending}
                  onClick={onChangeMethod}
                  type="button"
                  variant="outline"
                >
                  Привязать другую карту
                </Button>
                {subscription.paymentMethod === null ||
                subscription.paymentMethod.revoked ? null : (
                  <Button
                    className="h-auto min-h-11 max-w-full whitespace-normal"
                    disabled={pending}
                    onClick={onRevokeMethod}
                    type="button"
                    variant="ghost"
                  >
                    Запретить использование
                  </Button>
                )}
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Запрет останавливает будущие списания. Карту в банке мы не
                удаляем.
              </p>
            </div>
          </section>
        </>
      )}

      <section
        aria-labelledby="billing-history"
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <h2 className="text-xl font-semibold" id="billing-history">
          История сообщений
        </h2>
        {notices.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Служебных сообщений пока не было.
          </p>
        ) : (
          <ol className="mt-4 grid gap-3">
            {notices.map((notice) => (
              <li
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border pb-3 text-sm last:border-b-0 last:pb-0"
                key={notice.noticeRef}
              >
                <span className="min-w-0 font-medium">
                  {noticeLabel(notice.kind)}
                  {notice.state === "superseded" ? (
                    <span className="ml-2 text-xs text-muted-foreground">
                      неактуально
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {formatBillingDate(notice.occurredAt)}
                  {notice.amountKopecks === null
                    ? ""
                    : ` · ${formatKopecks(notice.amountKopecks)}`}
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          Чек и письма приходят на{" "}
          <Link
            className="text-action underline underline-offset-4"
            href={{ pathname: contactHref }}
          >
            подтверждённый email
          </Link>
          .
        </p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button
          className="h-auto min-h-11 max-w-full whitespace-normal"
          disabled={loading || pending}
          onClick={onRefresh}
          type="button"
          variant="outline"
        >
          Обновить данные
        </Button>
      </div>

      {error === undefined ? null : (
        <p className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm leading-6" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
