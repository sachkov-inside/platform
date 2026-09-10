"use client";
import type { ReactNode } from "react";

import {
  formatBillingDate,
  formatBillingDateTime,
  formatKopecks,
  formatMonths,
  type PriceSnapshot,
} from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import type {
  AccessGrantView,
  ApplyBatchInput,
  ArchiveInput,
  CancelSubscriptionInput,
  DecideRefundInput,
  ExecuteRefundInput,
  ExtendGrantInput,
  GrantBatchOutcome,
  GrantPreviewOutcome,
  GrantsOutcome,
  ListPaymentsInput,
  PaymentOutcome,
  PaymentView,
  PreviewBatchInput,
  PurchaseCommandInput,
  RefundsOutcome,
  RevokeGrantInput,
  SaveOfferInput,
  SavePaymentOptionInput,
  SavePromotionInput,
} from "../model/admin-operations";
import {
  AdminSection,
  AreaField,
  Field,
  SelectField,
  optionalNumber,
  optionalText,
  parseBenefits,
  text,
} from "./admin-form.client";

type Command<Input> = Omit<Input, "operationId">;

export interface BillingAdminViewProps {
  readonly offers: readonly PriceSnapshot[];
  readonly payments: readonly PaymentView[];
  readonly paymentsCursor: string | null;
  readonly payment: PaymentOutcome["result"] | null;
  readonly refunds: RefundsOutcome["result"] | null;
  readonly grants: GrantsOutcome["result"]["value"] | null;
  readonly preview: GrantPreviewOutcome["result"] | null;
  readonly batch: GrantBatchOutcome["result"] | null;
  readonly pending?: boolean;
  readonly error?: string | undefined;
  readonly notice?: string | undefined;
  readonly onSaveOffer: (input: Command<SaveOfferInput>) => void;
  readonly onArchiveOffer: (input: Command<ArchiveInput>) => void;
  readonly onSavePaymentOption: (input: Command<SavePaymentOptionInput>) => void;
  readonly onArchivePaymentOption: (input: Command<ArchiveInput>) => void;
  readonly onSavePromotion: (input: Command<SavePromotionInput>) => void;
  readonly onArchivePromotion: (input: Command<ArchiveInput>) => void;
  readonly onListPayments: (input: Command<ListPaymentsInput>) => void;
  readonly onReadPayment: (input: Command<PurchaseCommandInput>) => void;
  readonly onReconcilePayment: (input: Command<PurchaseCommandInput>) => void;
  readonly onCancelSubscription: (
    input: Command<CancelSubscriptionInput>,
  ) => void;
  readonly onDecideRefund: (input: Command<DecideRefundInput>) => void;
  readonly onExecuteRefund: (input: Command<ExecuteRefundInput>) => void;
  readonly onReadRefunds: (input: Command<PurchaseCommandInput>) => void;
  readonly onReadGrants: (input: { readonly accountId: string }) => void;
  readonly onExtendGrant: (input: Command<ExtendGrantInput>) => void;
  readonly onRevokeGrant: (input: Command<RevokeGrantInput>) => void;
  readonly onPreviewBatch: (input: Command<PreviewBatchInput>) => void;
  readonly onApplyBatch: (input: Command<ApplyBatchInput>) => void;
}

/**
 * Владельческий кабинет billing: те же операции и полномочия, что у admin API и MCP.
 * Каждая команда идёт своим маршрутом и возвращает ссылку на операцию.
 */
export function BillingAdminView({
  offers,
  payments,
  paymentsCursor,
  payment,
  refunds,
  grants,
  preview,
  batch,
  pending = false,
  error,
  notice,
  onSaveOffer,
  onArchiveOffer,
  onSavePaymentOption,
  onArchivePaymentOption,
  onSavePromotion,
  onArchivePromotion,
  onListPayments,
  onReadPayment,
  onReconcilePayment,
  onCancelSubscription,
  onDecideRefund,
  onExecuteRefund,
  onReadRefunds,
  onReadGrants,
  onExtendGrant,
  onRevokeGrant,
  onPreviewBatch,
  onApplyBatch,
}: BillingAdminViewProps) {
  return (
    <div className="mx-auto grid max-w-4xl gap-6 pb-16">
      <header className="grid gap-2">
        <h1 className="text-balance text-3xl font-bold tracking-[-0.04em]">
          Оплата и права
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Проверенные владельческие операции вместо правки базы. Реальные
          возвраты, выдачи и смена терминала требуют отдельного разрешения.
        </p>
      </header>

      {notice === undefined ? null : (
        <p className="rounded-xl border border-accent/35 bg-accent/6 p-4 text-sm" role="status">
          {notice}
        </p>
      )}
      {error === undefined ? null : (
        <p className="rounded-xl border border-destructive/30 bg-destructive/6 p-4 text-sm" role="alert">
          {error}
        </p>
      )}

      <AdminSection
        description="Активные варианты каталога с их редакциями. Архивные предложения здесь не перечисляются: их читает только команда сохранения по известному идентификатору."
        title="Действующий каталог"
      >
        {offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Активных вариантов нет.
          </p>
        ) : (
          <ul className="grid gap-3 text-sm">
            {offers.map((snapshot) => (
              <li
                className="grid gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0"
                key={snapshot.paymentOption.id}
              >
                <span className="font-semibold [overflow-wrap:anywhere]">
                  {snapshot.offer.name} ·{" "}
                  {formatMonths(snapshot.paymentOption.months)} ·{" "}
                  {formatKopecks(snapshot.paymentOption.priceKopecks)}
                </span>
                <span className="font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                  offer {snapshot.offer.id} r{snapshot.offer.revision} · option{" "}
                  {snapshot.paymentOption.id} r{snapshot.paymentOption.revision}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>

      <AdminSection
        description="Состав предложения — независимые права. Строка `capability=12` задаёт срок в месяцах, `capability=null` — бессрочное право."
        title="Предложение"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const parsed = parseBenefits(text(form.get("offerBenefits")));
            const revision = optionalNumber(form.get("offerRevision"));
            onSaveOffer({
              ...(revision === undefined ? {} : { expectedRevision: revision }),
              value: {
                id: text(form.get("offerId")),
                name: text(form.get("offerName")),
                benefits: [...parsed.benefits],
                ...(parsed.benefitPeriods.length === 0
                  ? {}
                  : { benefitPeriods: [...parsed.benefitPeriods] }),
              },
            });
          }}
        >
          <Field
            hint="UUID существующего предложения или новый."
            label="Идентификатор"
            name="offerId"
            required
          />
          <Field label="Название" maxLength={200} name="offerName" required />
          <AreaField
            hint="По одному праву в строке: materials, support, community, guide:<uuid>."
            label="Состав"
            name="offerBenefits"
            required
          />
          <Field
            hint="Пусто — создание нового предложения."
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="offerRevision"
          />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Сохранить предложение
            </Button>
          </p>
        </form>
        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onArchiveOffer({
              id: text(form.get("archiveOfferId")),
              expectedRevision: Number(text(form.get("archiveOfferRevision"))),
            });
          }}
        >
          <Field label="Архивировать предложение" name="archiveOfferId" required />
          <Field
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="archiveOfferRevision"
            required
          />
          <p>
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={pending}
              type="submit"
              variant="outline"
            >
              Архивировать
            </Button>
          </p>
        </form>
      </AdminSection>

      <AdminSection
        description="Вариант оплаты хранит длительность и цену в копейках. Архивирование не меняет действующие подписки."
        title="Вариант оплаты"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const revision = optionalNumber(form.get("optionRevision"));
            onSavePaymentOption({
              ...(revision === undefined ? {} : { expectedRevision: revision }),
              value: {
                id: text(form.get("optionId")),
                offerId: text(form.get("optionOfferId")),
                months: Number(text(form.get("optionMonths"))),
                priceKopecks: Number(text(form.get("optionPrice"))),
                mode: "subscription",
              },
            });
          }}
        >
          <Field label="Идентификатор варианта" name="optionId" required />
          <Field label="Идентификатор предложения" name="optionOfferId" required />
          <Field
            inputMode="numeric"
            label="Месяцев"
            name="optionMonths"
            required
          />
          <Field
            hint="В копейках: 350000 — это 3 500 ₽."
            inputMode="numeric"
            label="Цена"
            name="optionPrice"
            required
          />
          <Field
            hint="Пусто — создание нового варианта."
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="optionRevision"
          />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Сохранить вариант
            </Button>
          </p>
        </form>
        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onArchivePaymentOption({
              id: text(form.get("archiveOptionId")),
              expectedRevision: Number(text(form.get("archiveOptionRevision"))),
            });
          }}
        >
          <Field label="Архивировать вариант" name="archiveOptionId" required />
          <Field
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="archiveOptionRevision"
            required
          />
          <p>
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={pending}
              type="submit"
              variant="outline"
            >
              Архивировать
            </Button>
          </p>
        </form>
      </AdminSection>

      <AdminSection
        description="Скидка действует в своём окне и только на перечисленные предложения и варианты. Пустые списки означают «все»."
        title="Скидка"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const revision = optionalNumber(form.get("promotionRevision"));
            const usageLimit = optionalNumber(form.get("promotionLimit"));
            onSavePromotion({
              ...(revision === undefined ? {} : { expectedRevision: revision }),
              value: {
                id: text(form.get("promotionId")),
                name: text(form.get("promotionName")),
                percent: Number(text(form.get("promotionPercent"))),
                code: optionalText(form.get("promotionCode")) ?? null,
                startsAt: text(form.get("promotionStartsAt")),
                endsAt: text(form.get("promotionEndsAt")),
                offerIds: splitIds(text(form.get("promotionOffers"))),
                paymentOptionIds: splitIds(text(form.get("promotionOptions"))),
                usageLimit: usageLimit ?? null,
              },
            });
          }}
        >
          <Field label="Идентификатор скидки" name="promotionId" required />
          <Field label="Название" maxLength={200} name="promotionName" required />
          <Field
            inputMode="numeric"
            label="Процент"
            name="promotionPercent"
            required
          />
          <Field
            hint="Пусто — публичная скидка без кода."
            label="Промокод"
            name="promotionCode"
          />
          <Field
            hint="ISO 8601 со смещением: 2026-10-01T00:00:00+03:00."
            label="Начало"
            name="promotionStartsAt"
            required
          />
          <Field
            hint="ISO 8601 со смещением."
            label="Конец"
            name="promotionEndsAt"
            required
          />
          <Field
            hint="UUID через запятую; пусто — все."
            label="Предложения"
            name="promotionOffers"
          />
          <Field
            hint="UUID через запятую; пусто — все."
            label="Варианты оплаты"
            name="promotionOptions"
          />
          <Field
            hint="Пусто — без ограничения."
            inputMode="numeric"
            label="Лимит применений"
            name="promotionLimit"
          />
          <Field
            hint="Пусто — создание новой скидки."
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="promotionRevision"
          />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Сохранить скидку
            </Button>
          </p>
        </form>
        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onArchivePromotion({
              id: text(form.get("archivePromotionId")),
              expectedRevision: Number(
                text(form.get("archivePromotionRevision")),
              ),
            });
          }}
        >
          <Field label="Архивировать скидку" name="archivePromotionId" required />
          <Field
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="archivePromotionRevision"
            required
          />
          <p>
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={pending}
              type="submit"
              variant="outline"
            >
              Архивировать
            </Button>
          </p>
        </form>
      </AdminSection>

      <AdminSection
        description="Банковское состояние попытки отделено от готовности доступа и от чека."
        title="Платежи"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const accountId = optionalText(form.get("paymentsAccount"));
            const state = optionalText(form.get("paymentsState"));
            const kind = optionalText(form.get("paymentsKind"));
            onListPayments({
              limit: Number(text(form.get("paymentsLimit")) || "50"),
              ...(accountId === undefined ? {} : { accountId }),
              ...(state === undefined || state === "any"
                ? {}
                : { state: state as ListPaymentsInput["state"] }),
              ...(kind === undefined || kind === "any"
                ? {}
                : { kind: kind as ListPaymentsInput["kind"] }),
            });
          }}
        >
          <Field
            hint="Пусто — все Account."
            label="Account"
            name="paymentsAccount"
          />
          <SelectField
            label="Состояние"
            name="paymentsState"
            options={[
              { value: "any", label: "Любое" },
              { value: "prepared", label: "prepared" },
              { value: "sent", label: "sent" },
              { value: "unknown", label: "unknown" },
              { value: "pending", label: "pending" },
              { value: "authorized", label: "authorized" },
              { value: "confirmed", label: "confirmed" },
              { value: "failed", label: "failed" },
            ]}
          />
          <SelectField
            label="Вид"
            name="paymentsKind"
            options={[
              { value: "any", label: "Любой" },
              { value: "initial", label: "initial" },
              { value: "renewal", label: "renewal" },
              { value: "upgrade", label: "upgrade" },
            ]}
          />
          <Field
            defaultValue="50"
            inputMode="numeric"
            label="Сколько показать"
            name="paymentsLimit"
          />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Показать платежи
            </Button>
          </p>
        </form>

        {payments.length === 0 ? null : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <caption className="sr-only">Платежи</caption>
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-3 font-semibold">Платёж</th>
                  <th className="py-2 pr-3 font-semibold">Вид</th>
                  <th className="py-2 pr-3 font-semibold">Состояние</th>
                  <th className="py-2 pr-3 font-semibold">Сумма</th>
                  <th className="py-2 font-semibold">Доступ</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((row) => (
                  <tr className="border-b border-border" key={row.purchaseRef}>
                    <td className="py-2 pr-3 font-mono text-xs [overflow-wrap:anywhere]">
                      {row.purchaseRef}
                    </td>
                    <td className="py-2 pr-3">{row.kind}</td>
                    <td className="py-2 pr-3">{row.state}</td>
                    <td className="py-2 pr-3 font-mono tabular-nums">
                      {formatKopecks(row.amountKopecks)}
                    </td>
                    <td className="py-2">{row.access}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paymentsCursor === null ? null : (
              <p className="mt-2 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                Следующая страница: {paymentsCursor}
              </p>
            )}
          </div>
        )}

        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onReadPayment({ purchaseRef: text(form.get("paymentRef")) });
          }}
        >
          <Field label="Открыть платёж" name="paymentRef" required />
          <p className="flex flex-wrap gap-2">
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Прочитать
            </Button>
          </p>
        </form>

        {payment === null ? null : (
          <div className="grid gap-4 border-t border-border pt-5 text-sm">
            <dl className="grid gap-2">
              <AdminRow label="Платёж">{payment.value.purchaseRef}</AdminRow>
              <AdminRow label="Account">{payment.value.accountId}</AdminRow>
              <AdminRow label="Состояние">{payment.value.state}</AdminRow>
              <AdminRow label="Сумма">
                {formatKopecks(payment.value.amountKopecks)}
              </AdminRow>
              <AdminRow label="Возвращено">
                {formatKopecks(payment.value.refundedKopecks)}
              </AdminRow>
              <AdminRow label="Доступно к возврату">
                {formatKopecks(payment.value.refundableKopecks)}
              </AdminRow>
              <AdminRow label="Чек">{payment.value.fiscalization}</AdminRow>
              <AdminRow label="Терминал">
                {payment.value.environment} · {payment.value.terminalRef}
              </AdminRow>
            </dl>
            {payment.events.length === 0 ? null : (
              <div>
                <h3 className="font-semibold">События</h3>
                <ul className="mt-2 grid gap-1 font-mono text-xs">
                  {payment.events.map((entry) => (
                    <li key={`${entry.kind}:${entry.occurredAt}`}>
                      {formatBillingDateTime(entry.occurredAt)} · {entry.kind}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {payment.audit.length === 0 ? null : (
              <div>
                <h3 className="font-semibold">Журнал операций</h3>
                <ul className="mt-2 grid gap-1 text-xs">
                  {payment.audit.map((entry) => (
                    <li key={entry.operationId}>
                      <span className="font-mono">
                        {formatBillingDateTime(entry.createdAt)}
                      </span>{" "}
                      · {entry.operation} · {entry.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="flex flex-wrap gap-2">
              <Button
                className="h-auto min-h-11 max-w-full whitespace-normal"
                disabled={pending}
                onClick={() => {
                  onReconcilePayment({ purchaseRef: payment.value.purchaseRef });
                }}
                type="button"
                variant="outline"
              >
                Сверить с банком
              </Button>
              <Button
                className="h-auto min-h-11 max-w-full whitespace-normal"
                disabled={pending}
                onClick={() => {
                  onReadRefunds({ purchaseRef: payment.value.purchaseRef });
                }}
                type="button"
                variant="ghost"
              >
                Показать возвраты
              </Button>
            </p>
          </div>
        )}
      </AdminSection>

      <AdminSection
        description="Решение фиксирует сумму, судьбу доступа и автопродления. Исполнение наследует основание решения и не принимает новую сумму."
        title="Возвраты"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onDecideRefund({
              purchaseRef: text(form.get("refundPurchase")),
              amountKopecks: Number(text(form.get("refundAmount"))),
              access: text(form.get("refundAccess")) as "keep" | "revoke",
              recurring: text(form.get("refundRecurring")) as "keep" | "cancel",
              reason: text(form.get("refundReason")),
            });
          }}
        >
          <Field label="Платёж" name="refundPurchase" required />
          <Field
            hint="В копейках, не больше остатка."
            inputMode="numeric"
            label="Сумма"
            name="refundAmount"
            required
          />
          <SelectField
            label="Доступ"
            name="refundAccess"
            options={[
              { value: "keep", label: "Сохранить" },
              { value: "revoke", label: "Отозвать" },
            ]}
          />
          <SelectField
            label="Автопродление"
            name="refundRecurring"
            options={[
              { value: "keep", label: "Сохранить" },
              { value: "cancel", label: "Отменить" },
            ]}
          />
          <AreaField label="Основание" maxLength={1000} name="refundReason" required />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Принять решение
            </Button>
          </p>
        </form>

        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onExecuteRefund({
              decisionRef: text(form.get("executeDecision")),
              expectedRevision: Number(text(form.get("executeRevision"))),
            });
          }}
        >
          <Field label="Решение" name="executeDecision" required />
          <Field
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="executeRevision"
            required
          />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Исполнить возврат
            </Button>
          </p>
        </form>

        {refunds === null ? null : (
          <div className="border-t border-border pt-5 text-sm">
            <p>
              По платежу{" "}
              <span className="font-mono text-xs">{refunds.purchaseRef}</span>{" "}
              возвращено {formatKopecks(refunds.refundedKopecks)} из доступных{" "}
              {formatKopecks(refunds.refundableKopecks)}.
            </p>
            <ul className="mt-3 grid gap-2">
              {refunds.decisions.map((decision) => (
                <li className="grid gap-1" key={decision.decisionRef}>
                  <span className="font-mono text-xs [overflow-wrap:anywhere]">
                    {decision.decisionRef} · r{decision.revision} ·{" "}
                    {decision.state}
                  </span>
                  <span>
                    {formatKopecks(decision.amountKopecks)} · доступ{" "}
                    {decision.access} · продление {decision.recurring}
                  </span>
                  {decision.attempt === null ? null : (
                    <span className="text-xs text-muted-foreground">
                      Попытка {decision.attempt.state}
                      {decision.attempt.observedStatus === null
                        ? ""
                        : ` · ${decision.attempt.observedStatus}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </AdminSection>

      <AdminSection
        description="Отмена продления владельцем выполняет тот же use case, что и команда покупателя: оплаченный срок сохраняется."
        title="Подписка участника"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onCancelSubscription({
              accountId: text(form.get("cancelAccount")),
              expectedRevision: Number(text(form.get("cancelRevision"))),
              reason: text(form.get("cancelReason")),
            });
          }}
        >
          <Field label="Account" name="cancelAccount" required />
          <Field
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="cancelRevision"
            required
          />
          <AreaField label="Основание" maxLength={1000} name="cancelReason" required />
          <p>
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={pending}
              type="submit"
              variant="outline"
            >
              Отменить продление
            </Button>
          </p>
        </form>
      </AdminSection>

      <AdminSection
        description="Ручные и унаследованные основания живут отдельно от оплаченных: отзыв одного не трогает остальные."
        title="Права участника"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onReadGrants({ accountId: text(form.get("grantsAccount")) });
          }}
        >
          <Field label="Account" name="grantsAccount" required />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Показать права
            </Button>
          </p>
        </form>

        {grants === null ? null : (
          <div className="grid gap-3 border-t border-border pt-5 text-sm">
            {grants.grants.length === 0 ? (
              <p className="text-muted-foreground">Оснований нет.</p>
            ) : (
              <ul className="grid gap-3">
                {grants.grants.map((grant) => (
                  <GrantRow grant={grant} key={grant.grantRef} />
                ))}
              </ul>
            )}
          </div>
        )}

        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const validUntil = optionalText(form.get("extendUntil"));
            onExtendGrant({
              grantRef: text(form.get("extendGrant")),
              expectedRevision: Number(text(form.get("extendRevision"))),
              reason: text(form.get("extendReason")),
              validUntil: validUntil ?? null,
            });
          }}
        >
          <Field label="Продлить основание" name="extendGrant" required />
          <Field
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="extendRevision"
            required
          />
          <Field
            hint="ISO 8601 со смещением; пусто — бессрочно."
            label="Действует до"
            name="extendUntil"
          />
          <AreaField label="Основание" maxLength={1000} name="extendReason" required />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Продлить
            </Button>
          </p>
        </form>

        <form
          className="grid gap-4 border-t border-border pt-5"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            onRevokeGrant({
              grantRef: text(form.get("revokeGrant")),
              expectedRevision: Number(text(form.get("revokeRevision"))),
              reason: text(form.get("revokeReason")),
            });
          }}
        >
          <Field label="Отозвать основание" name="revokeGrant" required />
          <Field
            inputMode="numeric"
            label="Ожидаемая редакция"
            name="revokeRevision"
            required
          />
          <AreaField label="Основание" maxLength={1000} name="revokeReason" required />
          <p>
            <Button
              className="h-auto min-h-11 max-w-full whitespace-normal"
              disabled={pending}
              type="submit"
              variant="outline"
            >
              Отозвать
            </Button>
          </p>
        </form>
      </AdminSection>

      <AdminSection
        description="Предпросмотр ничего не выдаёт: он только сопоставляет строки с Account. Применяются только подтверждённые строки того же предпросмотра."
        title="Массовая выдача"
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const rows = parseGrantRows(text(form.get("batchRows")));
            if (rows.length > 0) onPreviewBatch({ rows });
          }}
        >
          <AreaField
            hint="Строка: rowKey | accountId | manual|legacy | sourceRef | capabilities через запятую | startsAt | validUntil или null | основание."
            label="Строки"
            name="batchRows"
            required
            rows={6}
          />
          <p>
            <Button className="h-auto min-h-11 max-w-full whitespace-normal" disabled={pending} type="submit">
              Собрать предпросмотр
            </Button>
          </p>
        </form>

        {preview === null ? null : (
          <div className="border-t border-border pt-5 text-sm">
            <p className="font-mono text-xs [overflow-wrap:anywhere]">
              {preview.previewRef} · r{preview.revision} · до{" "}
              {formatBillingDateTime(preview.expiresAt)}
            </p>
            <ul className="mt-3 grid gap-1">
              {preview.rows.map((row) => (
                <li key={row.rowKey}>
                  {row.rowKey} · {row.status === "confirmed" ? "найден" : "не найден"}
                </li>
              ))}
            </ul>
            <Button
              className="mt-3 h-auto min-h-11 max-w-full whitespace-normal"
              disabled={
                pending ||
                preview.rows.every((row) => row.status !== "confirmed")
              }
              onClick={() => {
                onApplyBatch({
                  previewRef: preview.previewRef,
                  expectedRevision: preview.revision,
                  confirmedRows: preview.rows
                    .filter((row) => row.status === "confirmed")
                    .map((row) => row.rowKey),
                });
              }}
              type="button"
            >
              Применить подтверждённые строки
            </Button>
          </div>
        )}

        {batch === null ? null : (
          <ul className="grid gap-1 border-t border-border pt-5 text-sm">
            {batch.rows.map((row) => (
              <li key={row.rowKey}>
                {row.rowKey} ·{" "}
                {row.result.ok
                  ? `выдано, r${String(row.result.revision)}`
                  : "конфликт операции"}
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  );
}

function GrantRow({ grant }: { readonly grant: AccessGrantView }) {
  return (
    <li className="grid gap-1 border-b border-border pb-3 last:border-b-0 last:pb-0">
      <span className="font-mono text-xs [overflow-wrap:anywhere]">
        {grant.grantRef} · r{grant.revision} · {grant.source}
      </span>
      <span>
        {grant.capabilities.join(", ")} ·{" "}
        {grant.validUntil === null
          ? "бессрочно"
          : `до ${formatBillingDate(grant.validUntil)}`}{" "}
        · {grant.active ? "действует" : "не действует"}
      </span>
      <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {grant.reason}
      </span>
    </li>
  );
}

function AdminRow({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-mono text-xs [overflow-wrap:anywhere]">
        {children}
      </dd>
    </div>
  );
}

function splitIds(value: string): string[] {
  return value
    .split(/[\s,]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Одна строка партии описывает ровно одно основание одного Account. */
function parseGrantRows(value: string): PreviewBatchInput["rows"] {
  return value
    .split("\n")
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 8)
    .map((cells) => ({
      rowKey: cells[0] ?? "",
      accountId: cells[1] ?? "",
      source: cells[2] === "legacy" ? "legacy" : "manual",
      sourceRef: cells[3] ?? "",
      terms: {
        capabilities: splitIds(cells[4] ?? ""),
        startsAt: cells[5] ?? "",
        validUntil: cells[6] === "null" ? null : (cells[6] ?? null),
        reason: cells[7] ?? "",
      },
    }));
}
