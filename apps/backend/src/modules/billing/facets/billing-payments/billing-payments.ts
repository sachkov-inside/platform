import { transactionHandle } from "../../../../infrastructure/prisma/transaction-handle.js";
import { productSaleAvailable } from "../../shared/product-sale-available.js";
import {
  accessCapabilitySchema,
  isProductCapability,
  productCapability,
  productIdFromCapability,
} from "@inside/access-capabilities";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { hasText } from "../../../../infrastructure/contracts/text.js";
import {
  dependencyFailure,
  reportDependencyFailure,
  writeLog,
} from "../../../../infrastructure/observability/index.js";
import {
  lockAccountEntitlementChanges,
  lockBillingPricing,
  lockBillingPurchase,
  type BillingPrisma,
  type BillingPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import type {
  AccessGrants,
  CoverageCatalog,
} from "../../../account-rights/index.js";
import type { BillingContact } from "../../../accounts/index.js";
import { attemptSourceRef, lifecycleWindow } from "../../domain/notice.js";
import {
  attemptKindSchema,
  isQuotedPurchase,
  retirementReasonSchema,
  type RetirementReason,
} from "../../domain/payment-attempt.js";
import {
  paymentMode,
  priceSnapshotSchema,
  type PriceSnapshot,
} from "../../domain/pricing.js";
import {
  saleCapability,
  type SaleCapability,
} from "../../domain/sale-capability.js";
import { acceptBankRefund } from "../../features/accept-bank-refund/accept-bank-refund.js";
import {
  ownPaymentSchema,
  type OwnPayment,
} from "../../features/manage-subscription/manage-subscription.contract.js";
import {
  paymentFailure,
  purchaseProductSchema,
  type PaymentFailureCode,
  purchaseStatusSchema,
  type PaymentResult,
  type PurchaseStatus,
} from "../../features/purchase-product/purchase-product.contract.js";
import {
  isOpenProductReservationConflict,
  reservePurchaseInTransaction,
} from "../../features/reserve-purchase/reserve-purchase.js";
import {
  BankInitRefused,
  bankTimeoutMs,
  isRecognizedBankStatus,
  refundTerminalStatuses,
  unpaidFormStatuses,
  validatedPaymentUrl,
  type BankPayment,
  type Tbank,
} from "../../infrastructure/tbank/tbank.js";
import { replayCommandFingerprint } from "../../shared/command-fingerprint.js";
import { openOrderEmail } from "../../shared/order-email.js";
import { paymentAdmission } from "../../shared/payment-admission.js";
import { recordBillingNotice } from "../../shared/record-notice.js";

const inFlightStates = ["prepared", "sent", "unknown", "pending", "authorized"];
/**
 * Отказ банка по форме оплаты не окончателен: покупатель может выбрать на той же форме другой
 * способ, и тот же PaymentId придёт подтверждённым. Сверка спрашивает банк о таком платеже ещё
 * сутки после создания покупки. Init уходит сразу после создания и не передаёт RedirectDueDate,
 * поэтому форма живёт срок банка по умолчанию, 24 часа: https://developer.tbank.ru/eacq/api/init
 */
export const declinedPaymentRecheckMilliseconds = 24 * 60 * 60 * 1000;
/**
 * Убывающий опрос формы, которая ещё может принять оплату: после отказа банка или у снятой
 * попытки, чью форму нужно отменить (#1929). Чем дольше форма живёт без оплаты, тем реже сверка
 * о ней спрашивает: раз в минуту первые 10 минут, раз в 5 минут до часа, раз в 15 минут до
 * 4 часов, затем раз в час до конца окна. За сутки это около 50 запросов вместо 1440.
 */
const bankRecheckSteps = [
  { ageBelowMilliseconds: 10 * 60_000, everyMilliseconds: 60_000 },
  { ageBelowMilliseconds: 60 * 60_000, everyMilliseconds: 5 * 60_000 },
  { ageBelowMilliseconds: 4 * 60 * 60_000, everyMilliseconds: 15 * 60_000 },
] as const;
const finalBankRecheckEveryMilliseconds = 60 * 60_000;
/**
 * Самая долгая строка сверки: до четырёх запросов к банку по `bankTimeoutMs`. Это CheckOrder,
 * если PaymentId ещё нет, GetState сверки, затем GetState и Cancel отмены формы (#1923).
 */
const recoveryItemMilliseconds = 4 * bankTimeoutMs;

/**
 * Бюджет прохода сверки меньше срока задания на две самые долгие строки: одну, начатую в последний
 * миг бюджета, и одну в запас на работу с базой после запросов к банку (#1929).
 */
export function recoveryBudgetMilliseconds(jobDeadlineSeconds: number): number {
  return jobDeadlineSeconds * 1_000 - 2 * recoveryItemMilliseconds;
}
/**
 * Частичный возврат по неподтверждённой покупке: сумма не доказана, и покупку проверяет владелец.
 * Покупка снимается с ожидания, чтобы не держать продукт (#1929).
 */
const partialRefundReleased = "partial_refund_released";
/**
 * Неоплаченная повторная попытка. Удержанные деньги остаются на сверке. Попытку с неизвестным
 * исходом сверка сначала сверяет с банком и снимает, только если форма не оплачена.
 */
const supersedableStates = ["prepared", "sent", "pending"];
/** Покупка снята до Init; причина в `payload.reason`, статус покупки отдаёт её покупателю. */
const dispatchRetiredEvent = "dispatch_retired";
const dispatchRetiredPayloadSchema = z.object({
  reason: retirementReasonSchema,
});
/**
 * Открытая попытка с PaymentId, о форме которой покупка по другой цене спрашивает банк (#1925).
 * Неизвестный исход банк может прояснить: неоплаченная форма станет `pending` и будет заменена.
 */
const bankCheckedStates = ["pending", "unknown"];
/**
 * Отметка снятой попытки: её форму в банке нужно отменить (#1923). Отметку закрывает событие
 * `bank_cancel_confirmed` со статусом банка: `CANCELED` после Cancel или статус, который закрыл
 * форму без него. Сторож (#1928) читает эти события по имени.
 */
const bankCancelRequested = "bank_cancel_requested";
const bankCancelConfirmed = "bank_cancel_confirmed";
/**
 * Cancel опоздал: покупатель оплатил форму между GetState и Cancel, и банк вернул деньги или
 * снял холд. Событие показывает владельцу, что деньги вернул Cancel кода, а не кабинет банка.
 */
const bankCancelReturnedPayment = "bank_cancel_returned_payment";
/**
 * В банке нет платежа попытки (#1922). Причина лежит в `payload.reason`: `init_not_sent`,
 * `init_declined` с кодом и текстом отказа банка или `check_order_empty`. Событие закрывает и
 * отметку отмены: отменять в банке нечего. Сторож (#1928) читает его по имени.
 */
const bankPaymentAbsent = "bank_payment_absent";
type BankPaymentAbsence =
  | { readonly reason: "init_not_sent" }
  | {
      readonly reason: "init_declined";
      readonly errorCode: string;
      readonly message: string | null;
    }
  | { readonly reason: "check_order_empty"; readonly firstEmptyAt: string };
/** Первый ответ CheckOrder без платежей заказа: от него отсчитывается окно отсутствия платежа. */
const bankOrderEmpty = "bank_order_empty";
/**
 * Окно отсутствия платежа. Попытку без PaymentId закрывает пустой ответ CheckOrder не раньше
 * этого срока после первого пустого ответа и после создания покупки. Ответ Init ждёт не дольше
 * `bankTimeoutMs`, поэтому платёж, созданный потерянным Init, CheckOrder покажет задолго до
 * конца окна. Непустой ответ без сохранённого PaymentId окно не сбрасывает.
 */
const bankPaymentAbsenceWindowMilliseconds = 30 * 60 * 1000;
/** События, после которых отметке отмены нечего отменять: форма закрыта или платежа нет. */
const bankCancelClosingEvents: readonly string[] = [
  bankCancelConfirmed,
  bankPaymentAbsent,
];
/** После этих статусов форма уже не принимает оплату, и Cancel ей не нужен. */
const closedFormStatuses: readonly BankPayment["Status"][] = [
  "CANCELED",
  "ATTEMPTS_EXPIRED",
  "DEADLINE_EXPIRED",
  "REVERSED",
  "CONFIRMED",
  "REFUNDED",
];
/** Отказ банка по попытке. Тот же PaymentId ещё может прийти подтверждённым. */
const declinedStatuses: readonly BankPayment["Status"][] = [
  "REJECTED",
  "AUTH_FAIL",
  "CANCELED",
  "ATTEMPTS_EXPIRED",
  "DEADLINE_EXPIRED",
  "REVERSED",
];
/**
 * Частичный возврат подтверждённого (`PARTIAL_REFUNDED`) или авторизованного (`PARTIAL_REVERSED`)
 * платежа. Его Amount не равен сумме покупки и не доказывает сумму возврата.
 */
const partialReturnStatuses: readonly BankPayment["Status"][] = [
  "PARTIAL_REFUNDED",
  "PARTIAL_REVERSED",
];
/**
 * Банк ещё не решил исход операции: деньги могли уже двигаться, поэтому покупка ждёт сверки.
 * `PAY_CHECKING` и `CONFIRM_CHECKING` банк ставит, когда сам не знает исход авторизации:
 * https://developer.tbank.ru/eacq/intro/developer/operation-statuses
 */
const undecidedStatuses: readonly BankPayment["Status"][] = [
  "PAY_CHECKING",
  "CONFIRM_CHECKING",
  "REVERSING",
  "REFUNDING",
  "ASYNC_REFUNDING",
];
const fulfillmentRetryDelayMilliseconds = 60_000;
// Кабинет показывает обозримую историю; полный журнал платежей остаётся владельческой операцией.
const ownPaymentHistoryLimit = 50;
// Derived from the bank's own timeout, so a caller outlives exactly one honest round-trip.
const inFlightAnswerBudgetMilliseconds = bankTimeoutMs + 2_000;
const inFlightAnswerPollMilliseconds = 200;
// Разовая покупка не просит банк сохранять привязку: инициатор без card-on-file.

interface Dependencies {
  readonly prisma: BillingPrismaClient;
  readonly contact: Pick<BillingContact, "read" | "readConsents">;
  readonly grants: Pick<
    AccessGrants,
    | "resolveCapabilities"
    | "resolveCapabilitiesMany"
    | "issueProductAccess"
    | "hasProductAcquisition"
  >;
  readonly contentCatalog?: Pick<CoverageCatalog, "resolve" | "resolveMany">;
  readonly bank: Tbank | undefined;
  /** Process commerce capability; absent uses the current product-only policy. */
  readonly sale?: SaleCapability;
  readonly clock?: () => Date;
}

/** Purchase, authoritative confirmation and recoverable fulfillment. Never repeats Init. */
export class BillingPayments {
  private readonly clock: () => Date;
  private readonly sale: SaleCapability;
  constructor(private readonly dependencies: Dependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
    this.sale = saleCapability(
      dependencies.bank?.config,
      dependencies.sale?.payments ?? true,
    );
  }

  async purchase(
    accountId: string,
    input: unknown,
    receiptEmail?: string,
  ): Promise<PaymentResult<PurchaseStatus>> {
    const parsed = purchaseProductSchema.safeParse(input);
    if (!z.uuid().safeParse(accountId).success || !parsed.success)
      return paymentFailure("invalid_request");
    const bank = this.dependencies.bank;
    if (!bank) return paymentFailure("method_unavailable");
    const command = parsed.data;
    const fingerprint = replayCommandFingerprint("purchase", command);
    try {
      const replay =
        await this.dependencies.prisma.billingPurchaseCommand.findUnique({
          where: {
            accountId_operationId: {
              accountId,
              operationId: command.operationId,
            },
          },
        });
      if (replay)
        return fingerprint.recognizes(replay.fingerprint)
          ? await this.continuePurchase(accountId, replay.purchaseRef)
          : paymentFailure("operation_conflict");
      // Only one-time Product quotes admit a new purchase; historical recurring snapshots stay passive.
      const quote = await this.dependencies.prisma.billingPriceQuote.findFirst({
        where: { id: command.quoteRef, accountId },
      });
      if (!quote) return paymentFailure("not_found");
      const snapshot = priceSnapshotSchema.parse(quote.snapshot);
      const mode = paymentMode(snapshot.paymentOption);
      if (mode !== "one_time") return paymentFailure("method_unavailable");
      const [contact, initialCapabilities] = await Promise.all([
        this.dependencies.contact.read(accountId),
        this.dependencies.grants.resolveCapabilities(accountId),
      ]);
      if (!contact.ok || !initialCapabilities.ok)
        return paymentFailure("dependency_unavailable");
      if (
        !contact.documents.some(
          (document) =>
            document.kind === "terms" &&
            document.commercialModel === "product-lifetime-v1",
        )
      )
        return paymentFailure("method_unavailable");
      let settledPurchaseRef: string | undefined;
      const admission = paymentAdmission({
        snapshot,
        sale: this.sale,
      });
      if (!admission.ok) return paymentFailure(admission.error.code);
      const orderEmail = receiptEmail ?? command.email;
      if (
        orderEmail === undefined &&
        (!contact.contact ||
          contact.contact.revision !== command.contactRevision)
      )
        return paymentFailure("contact_required");
      const email = orderEmail ?? contact.contact?.email;
      if (email === undefined) return paymentFailure("contact_required");
      const { email: _email, ...storedCommand } = command;
      const productId = snapshot.product?.id ?? snapshot.paymentOption.id;
      const consents = await this.dependencies.contact.readConsents(
        accountId,
        command.consentEvidenceRefs,
      );
      if (
        consents.some(
          (result) => !result.ok && result.error.code === "internal_error",
        )
      )
        return paymentFailure("dependency_unavailable");
      if (consents.some((result) => !result.ok))
        return paymentFailure("consent_required");
      const evidence = consents.flatMap((result) =>
        result.ok ? [result.evidence] : [],
      );
      const requiredConsents = ["terms"];
      if (
        new Set(evidence.map((value) => value.document.kind)).size !==
          evidence.length ||
        evidence.some(
          (value) =>
            value.contextRef !== command.quoteRef ||
            !contact.documents.some(
              (document) =>
                document.kind === value.document.kind &&
                document.documentId === value.document.documentId &&
                document.version === value.document.version &&
                document.digest === value.document.digest,
            ),
        ) ||
        // Разовая покупка не принимает согласие на списания даже добровольно: списаний не будет.
        evidence.some((value) => value.document.kind === "recurring") ||
        !requiredConsents.every((kind) =>
          evidence.some((value) => value.document.kind === kind),
        )
      )
        return paymentFailure("consent_required");
      const bankUnpaidAttemptRef = await this.unpaidAttemptAtOtherPrice(
        accountId,
        productId,
        snapshot,
      );
      const prepare = () =>
        this.dependencies.prisma.$transaction(
          async (
            tx,
          ): Promise<
            PaymentResult<string | { readonly settledPurchaseRef: string }>
          > => {
            await lockBillingPricing(tx);
            const key = { accountId, operationId: command.operationId };
            const existingCommand = await tx.billingPurchaseCommand.findUnique({
              where: { accountId_operationId: key },
            });
            if (existingCommand)
              return fingerprint.recognizes(existingCommand.fingerprint)
                ? { ok: true, value: existingCommand.purchaseRef }
                : paymentFailure("operation_conflict");
            const now = this.clock();
            // A completed lifecycle remains in history; only a later new purchase can reserve another slot.

            let continuingPurchase = await tx.billingPurchase.findFirst({
              where: openAttemptWhere(accountId, productId),
              orderBy: { createdAt: "desc" },
            });
            if (continuingPurchase === null) {
              const confirmed = await tx.billingPurchase.findFirst({
                where: {
                  accountId,
                  kind: "one_time",
                  state: "confirmed",
                  ...savedContentProductWhere(productId),
                },
                orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              });
              if (confirmed !== null) {
                const waiting = await tx.billingFulfillment.count({
                  where: { purchaseRef: confirmed.id, appliedAt: null },
                });
                if (waiting > 0) continuingPurchase = confirmed;
                else if (settledPurchaseRef !== confirmed.id)
                  return {
                    ok: true,
                    value: { settledPurchaseRef: confirmed.id },
                  };
              }
            }
            const decision =
              continuingPurchase === null
                ? null
                : await decideOpenAttempt(
                    tx,
                    continuingPurchase,
                    snapshot,
                    bankUnpaidAttemptRef,
                  );
            // Банк не подтвердил, что форма по прежней цене не оплачена: покупатель повторит
            // ту же команду, а не попадёт на форму по прежней цене.
            if (decision?.kind === "unverified")
              return paymentFailure("provider_unavailable");
            const replaced =
              decision?.kind === "replace" ? decision.attempt : null;
            if (continuingPurchase && replaced === null) {
              await tx.billingPurchaseCommand.create({
                data: {
                  ...key,
                  fingerprint: fingerprint.digest,
                  purchaseRef: continuingPurchase.id,
                },
              });
              return { ok: true, value: continuingPurchase.id };
            }
            // Product -> Account lock order matches manual and Course issuance.
            if (
              !(await productSaleAvailable(
                this.dependencies.contentCatalog,
                snapshot,
                transactionHandle(tx),
              ))
            )
              return paymentFailure("not_found");
            await lockAccountEntitlementChanges(tx, accountId);
            const acquired =
              await this.dependencies.grants.hasProductAcquisition(
                accountId,
                productId,
                transactionHandle(tx),
              );
            if (!acquired.ok) return paymentFailure("dependency_unavailable");
            if (acquired.acquired) return paymentFailure("existing_access");
            const purchaseRef = randomUUID();
            // Снятие откатывается вместе с транзакцией, если новая попытка не создана.
            const rejectPurchase = (code: PaymentFailureCode) => {
              if (replaced !== null) throw new ReplacementRejected(code);
              return paymentFailure(code);
            };
            if (replaced !== null)
              await retireReplacedAttempt(tx, replaced, purchaseRef, now);
            const reservation = await reservePurchaseInTransaction(
              tx,
              {
                accountId,
                purchaseRef,
                quoteRef: command.quoteRef,
                amountLimits: {
                  minimumKopecks: bank.config.minimumKopecks,
                  maximumKopecks: bank.config.maximumKopecks,
                },
              },
              now,
              this.dependencies.contentCatalog,
            );
            if (!reservation.ok)
              return rejectPurchase(
                reservation.error.code === "reservation_conflict"
                  ? "payment_in_progress"
                  : reservation.error.code,
              );
            // Расчёт мог быть сохранён, пока основание ещё действовало: допуск проверяется и здесь.
            const admission = paymentAdmission({
              snapshot: reservation.value,
              sale: this.sale,
            });
            if (!admission.ok) {
              await tx.billingPromoReservation.delete({
                where: { purchaseRef },
              });
              return rejectPurchase(admission.error.code);
            }
            await tx.billingPurchase.create({
              data: {
                id: purchaseRef,
                accountId,
                quoteRef: command.quoteRef,
                state: "prepared",
                environment: bank.config.environment,
                // Разовая покупка не занимает место подписки: она ничем не продлевается и заканчивается собой.
                kind: "one_time",
                lifecycleActive: false,
                terminalRef: bank.config.terminalKey,
                amountKopecks: reservation.value.firstPriceKopecks,
                snapshot: reservation.value,
                acceptance: {
                  commercialModel: "product-lifetime-v1",
                  command: storedCommand,
                  evidence,
                },
                contact: {
                  ...(orderEmail === undefined && contact.contact !== null
                    ? {
                        revision: contact.contact.revision,
                        verifiedAt: contact.contact.verifiedAt,
                      }
                    : { source: "order" }),
                  emailCiphertext: bank.sealBinding(
                    `${purchaseRef}:contact`,
                    email,
                  ),
                },
                fiscalization: "pending",
                createdAt: now,
                updatedAt: now,
              },
            });
            await tx.billingPurchaseCommand.create({
              data: { ...key, fingerprint: fingerprint.digest, purchaseRef },
            });
            return { ok: true, value: purchaseRef };
          },
        );
      let prepared = await prepare();
      while (prepared.ok) {
        if (typeof prepared.value === "string")
          return await this.continuePurchase(accountId, prepared.value);
        // Fulfillment may finish after admission read. Refresh outside the pricing transaction;
        // a different confirmed purchase on the next pass requires its own fresh access read.
        settledPurchaseRef = prepared.value.settledPurchaseRef;
        const refreshed =
          await this.dependencies.grants.resolveCapabilities(accountId);
        if (!refreshed.ok) return paymentFailure("dependency_unavailable");
        prepared = await prepare();
      }
      return prepared;
    } catch (error) {
      if (error instanceof ReplacementRejected)
        return paymentFailure(error.code);
      // Another open purchase of this Product holds the reservation: an answer, not a failure.
      if (isOpenProductReservationConflict(error))
        return paymentFailure("payment_in_progress");
      return dependencyFailure(
        { module: "billing", operation: "purchase" },
        error,
        paymentFailure("dependency_unavailable"),
      );
    }
  }

  /**
   * Открытая попытка того же продукта по другой цене (#1925). Перед заменой банк отвечает о её
   * форме, и ответ записывается как при сверке. Возвращает ссылку попытки, если банк назвал форму
   * неоплаченной; иначе `null`, и покупка продолжит открытую попытку. Банк недоступен: тоже `null`.
   */
  private async unpaidAttemptAtOtherPrice(
    accountId: string,
    productId: string,
    snapshot: PriceSnapshot,
  ): Promise<string | null> {
    const { prisma, bank } = this.dependencies;
    const open = await prisma.billingPurchase.findFirst({
      where: openAttemptWhere(accountId, productId),
      orderBy: { createdAt: "desc" },
      select: { id: true, amountKopecks: true, snapshot: true },
    });
    if (
      bank === undefined ||
      open === null ||
      !pricedDifferently(open, snapshot)
    )
      return null;
    try {
      await this.awaitBankAnswer(open.id);
      const row = await prisma.billingPurchase.findUniqueOrThrow({
        where: { id: open.id },
        select: {
          state: true,
          paymentId: true,
          environment: true,
          terminalRef: true,
        },
      });
      if (
        !bankCheckedStates.includes(row.state) ||
        !hasText(row.paymentId) ||
        row.environment !== bank.config.environment ||
        row.terminalRef !== bank.config.terminalKey
      )
        return null;
      const payment = await bank.state(row.paymentId);
      if (payment.OrderId !== open.id || payment.PaymentId !== row.paymentId)
        return null;
      const accepted = await this.accept(payment);
      return accepted.ok && unpaidFormStatuses.includes(payment.Status)
        ? open.id
        : null;
    } catch (error) {
      reportDependencyFailure(
        { module: "billing", operation: "purchase" },
        error,
      );
      return null;
    }
  }

  /** Immutable order recipient; the Account argument prevents cross-account reads. */
  async purchaseEmail(
    accountId: string,
    purchaseRef: string,
  ): Promise<PaymentResult<string | null>> {
    if (
      !z.uuid().safeParse(accountId).success ||
      !z.uuid().safeParse(purchaseRef).success
    )
      return paymentFailure("invalid_request");
    try {
      const row = await this.dependencies.prisma.billingPurchase.findFirst({
        where: { id: purchaseRef, accountId },
        select: { contact: true },
      });
      if (!row) return { ok: true, value: null };
      const bank = this.dependencies.bank;
      if (!bank) return paymentFailure("dependency_unavailable");
      return {
        ok: true,
        value: openOrderEmail(bank, purchaseRef, row.contact),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "purchaseEmail" },
        error,
        paymentFailure("dependency_unavailable"),
      );
    }
  }

  /** Linked contact takes priority; otherwise renewal retains the first order's recipient. */
  private async continuePurchase(
    accountId: string,
    purchaseRef: string,
  ): Promise<PaymentResult<PurchaseStatus>> {
    const bank = this.dependencies.bank;
    if (!bank) return paymentFailure("method_unavailable");
    const dispatched = await this.dispatch(purchaseRef);
    if (dispatched === "already_owned")
      return paymentFailure("existing_access");
    await this.awaitBankAnswer(purchaseRef);
    if (dispatched === "skipped") {
      // Запрос покупателя не ждёт Cancel снятой попытки: форму в банке закрывает фоновая сверка.
      const reconciled = await this.reconcileAttempt(purchaseRef, "never");
      if (!reconciled.ok) return reconciled;
    }
    const result = await this.status(accountId, purchaseRef);
    if (!result.ok || result.value.paymentUrl === null) return result;
    return {
      ok: true,
      value: purchaseStatusSchema.parse({
        ...result.value,
        paymentUrl: validatedPaymentUrl(
          result.value.paymentUrl,
          bank.config.endpoints.formOrigins,
        ),
      }),
    };
  }

  /** Restore the latest own Product purchase independently of a browser or an Offer revision. */
  async restoreProductPurchase(
    accountId: string,
    productId: string,
    purchaseRef?: string,
  ): Promise<PaymentResult<PurchaseStatus | null>> {
    if (
      !z.uuid().safeParse(accountId).success ||
      !z.uuid().safeParse(productId).success ||
      (purchaseRef !== undefined && !z.uuid().safeParse(purchaseRef).success)
    )
      return paymentFailure("not_found");
    try {
      const purchase = await this.dependencies.prisma.billingPurchase.findFirst(
        {
          where: {
            accountId,
            ...(purchaseRef === undefined ? {} : { id: purchaseRef }),
            ...savedContentProductWhere(productId),
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { id: true },
        },
      );
      if (purchase === null && purchaseRef !== undefined)
        return paymentFailure("not_found");
      return purchase === null
        ? { ok: true, value: null }
        : await this.status(accountId, purchase.id, productId);
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "restoreProductPurchase" },
        error,
        paymentFailure("dependency_unavailable"),
      );
    }
  }

  async status(
    accountId: string,
    purchaseRef: string,
    productId?: string,
  ): Promise<PaymentResult<PurchaseStatus>> {
    if (
      !z.uuid().safeParse(accountId).success ||
      !z.uuid().safeParse(purchaseRef).success
    )
      return paymentFailure("not_found");
    try {
      const row = await this.dependencies.prisma.billingPurchase.findFirst({
        where: { id: purchaseRef, accountId },
      });
      if (!row) return paymentFailure("not_found");
      const outstanding =
        await this.dependencies.prisma.billingFulfillment.findMany({
          where: { purchaseRef, appliedAt: null },
          select: { reviewRequiredAt: true },
        });
      const waiting = outstanding.length;
      const reviewRequired = outstanding.some(
        (entry) => entry.reviewRequiredAt !== null,
      );
      const snapshot = priceSnapshotSchema.parse(row.snapshot);
      const productIds =
        productId === undefined
          ? savedContentProductIds(snapshot)
          : [productId];
      const capabilities =
        row.state === "confirmed" && waiting === 0 && productIds.length > 0
          ? await this.dependencies.grants.resolveCapabilities(accountId, {
              productIds,
            })
          : null;
      if (capabilities !== null && !capabilities.ok)
        return paymentFailure("dependency_unavailable");
      const ready =
        capabilities === null ||
        capabilities.capabilities.some(
          (entry) =>
            entry.capability === "materials" ||
            productIds.some((id) => entry.capability === productCapability(id)),
        );
      const refunds = await this.dependencies.prisma.billingRefund.aggregate({
        where: { purchaseRef, state: "confirmed" },
        _sum: { amountKopecks: true },
      });
      const retirement =
        row.state === "failed"
          ? await this.dependencies.prisma.billingPaymentEvent.findUnique({
              where: {
                purchaseRef_kind: { purchaseRef, kind: dispatchRetiredEvent },
              },
              select: { payload: true },
            })
          : null;
      return {
        ok: true,
        value: purchaseStatusSchema.parse({
          purchaseRef,
          state: row.state,
          retirementReason:
            retirement === null
              ? null
              : dispatchRetiredPayloadSchema.parse(retirement.payload).reason,
          refundedKopecks: row.refundReviewRequired
            ? null
            : Number(refunds._sum.amountKopecks ?? 0),
          paymentUrl: row.state === "pending" ? row.paymentUrl : null,
          snapshot: row.snapshot,
          access: purchaseAccess(row.state, waiting, ready, reviewRequired),
          fiscalization: row.fiscalization,
          confirmedAt: row.confirmedAt?.toISOString() ?? null,
          periodEndsAt: row.periodEndsAt?.toISOString() ?? null,
        }),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "status" },
        error,
        paymentFailure("dependency_unavailable"),
      );
    }
  }

  /** История списаний Account: последние попытки, новые сверху, без данных провайдера. */
  async history(accountId: string): Promise<PaymentResult<OwnPayment[]>> {
    if (!z.uuid().safeParse(accountId).success)
      return paymentFailure("forbidden");
    try {
      const rows = await this.dependencies.prisma.billingPurchase.findMany({
        where: { accountId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: ownPaymentHistoryLimit,
      });
      const purchaseRefs = rows.map((row) => row.id);
      const snapshots = rows.map((row) =>
        priceSnapshotSchema.parse(row.snapshot),
      );
      const scopes = snapshots.map(
        (snapshot) =>
          snapshot.offer.coverage ?? {
            productIds: snapshot.offer.benefits
              .filter(isProductCapability)
              .map(
                (value) =>
                  productIdFromCapability(
                    accessCapabilitySchema.parse(value),
                  ) ?? "",
              ),
            materialIds: [],
          },
      );
      const [refunds, fulfillment, contents] = await Promise.all([
        this.dependencies.prisma.billingRefund.groupBy({
          by: ["purchaseRef"],
          where: { purchaseRef: { in: purchaseRefs }, state: "confirmed" },
          _sum: { amountKopecks: true },
          _max: { updatedAt: true },
        }),
        this.dependencies.prisma.billingFulfillment.groupBy({
          by: ["purchaseRef"],
          where: { purchaseRef: { in: purchaseRefs }, appliedAt: null },
          _count: { _all: true },
          _max: { reviewRequiredAt: true },
        }),
        this.dependencies.contentCatalog?.resolveMany(scopes),
      ]);
      const refundsByPurchase = new Map(
        refunds.map((row) => [row.purchaseRef, row]),
      );
      const waitingByPurchase = new Map(
        fulfillment.map((row) => [row.purchaseRef, row._count._all]),
      );
      const reviewByPurchase = new Map(
        fulfillment.map((row) => [
          row.purchaseRef,
          row._max.reviewRequiredAt !== null,
        ]),
      );
      const statusProductIds = snapshots.map(savedContentProductIds);
      const productIds = [
        ...new Set([
          ...statusProductIds.flat(),
          ...(contents?.flatMap((entries) =>
            entries
              .filter((entry) => entry.kind === "product")
              .map((entry) => entry.id),
          ) ?? []),
        ]),
      ];
      if (productIds.length > 2000)
        throw new Error(
          "Payment history Product composition exceeds supported size",
        );
      const readyByProduct = new Map<string, boolean>();
      // The rights port accepts at most 1000 resources per snapshot read.
      for (let offset = 0; offset < productIds.length; offset += 1000) {
        const batch = productIds.slice(offset, offset + 1000);
        const rights = await this.dependencies.grants.resolveCapabilitiesMany(
          accountId,
          batch.map((id) => ({ productIds: [id] })),
        );
        if (!rights.ok) throw new Error(rights.error.code);
        batch.forEach((id, index) =>
          readyByProduct.set(
            id,
            rights.values[index]?.capabilities.some(
              (right) =>
                right.capability === "materials" ||
                right.capability === productCapability(id),
            ) === true,
          ),
        );
      }
      return {
        ok: true,
        value: rows.map((row, index) => {
          const snapshot = snapshots[index];
          if (snapshot === undefined)
            throw new Error("Missing payment snapshot");
          const refunded = refundsByPurchase.get(row.id);
          const waiting = waitingByPurchase.get(row.id) ?? 0;
          const ids = statusProductIds[index] ?? [];
          const ready =
            ids.length === 0 ||
            ids.some((id) => readyByProduct.get(id) === true);
          const reviewRequired = reviewByPurchase.get(row.id) === true;
          const access = purchaseAccess(
            row.state,
            waiting,
            ready,
            reviewRequired,
          );
          const content = contents?.[index];
          const productEntries = content?.filter(
            (entry) => entry.kind === "product",
          );
          return ownPaymentSchema.parse({
            purchaseRef: row.id,
            snapshot,
            access,
            ...(content === undefined ? {} : { content }),
            ...(productEntries === undefined
              ? {}
              : {
                  productAccess: productEntries.map((entry) => ({
                    productId: entry.id,
                    access: purchaseAccess(
                      row.state,
                      waiting,
                      readyByProduct.get(entry.id) === true,
                      reviewRequired,
                    ),
                  })),
                }),
            kind: row.kind,
            state: row.state,
            amountKopecks: Number(row.amountKopecks),
            offerName: snapshot.offer.name,
            months: snapshot.paymentOption.months,
            fiscalization: row.fiscalization,
            confirmedAt: row.confirmedAt?.toISOString() ?? null,
            periodEndsAt: row.periodEndsAt?.toISOString() ?? null,
            createdAt: row.createdAt.toISOString(),
            refundedKopecks: row.refundReviewRequired
              ? null
              : Number(refunded?._sum.amountKopecks ?? 0),
            refundedAt: refunded?._max.updatedAt?.toISOString() ?? null,
          });
        }),
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "history" },
        error,
        paymentFailure("dependency_unavailable"),
      );
    }
  }

  async notification(input: unknown): Promise<PaymentResult<true>> {
    const payment = this.dependencies.bank?.notification(input);
    if (!payment) return paymentFailure("invalid_notification");
    return this.accept(payment);
  }

  /** Сверка одной покупки с банком; снятая попытка с неоплаченной формой получает Cancel. */
  async reconcile(purchaseRef: string): Promise<PaymentResult<true>> {
    return this.reconcileAttempt(purchaseRef, "retired_form");
  }

  private async reconcileAttempt(
    purchaseRef: string,
    sendCancel: "retired_form" | "never",
  ): Promise<PaymentResult<true>> {
    const { prisma, bank } = this.dependencies;
    try {
      const row = await prisma.billingPurchase.findUnique({
        where: { id: purchaseRef },
      });
      if (!row) return paymentFailure("not_found");
      if (row.state === "prepared" && row.kind !== "one_time") {
        await prisma.$transaction(async (tx) => {
          await lockBillingPricing(tx);
          await lockBillingPurchase(tx, row.id);
          const current = await tx.billingPurchase.findUniqueOrThrow({
            where: { id: row.id },
          });
          if (current.state !== "prepared" || current.kind === "one_time")
            return;
          const now = this.clock();
          await tx.billingPurchase.update({
            where: { id: row.id },
            data: {
              state: "failed",
              lifecycleActive: false,
              paymentUrl: null,
              updatedAt: now,
            },
          });
          await tx.billingPromoReservation.updateMany({
            where: { purchaseRef: row.id },
            data: { state: "failed" },
          });
          await tx.billingPaymentEvent.create({
            data: {
              id: randomUUID(),
              purchaseRef: row.id,
              kind: "legacy_dispatch_retired",
              payload: {
                kind: current.kind,
                reason:
                  "Unsent recurring operation retired without bank dispatch",
              },
              occurredAt: now,
              recordedAt: now,
            },
          });
        });
        return { ok: true, value: true };
      }
      if (!bank) return paymentFailure("method_unavailable");
      if (
        row.environment !== bank.config.environment ||
        row.terminalRef !== bank.config.terminalKey
      )
        return paymentFailure("method_unavailable");
      if (row.state === "prepared") {
        const outcome = await this.dispatch(row.id);
        if (outcome === "configuration_idle")
          return paymentFailure("method_unavailable");
        if (outcome === "failed") return paymentFailure("provider_unavailable");
        return { ok: true, value: true };
      }
      // Разовую покупку с PaymentId спрашиваем и после отказа: он мог смениться оплатой.
      // Снятую попытку без PaymentId с открытой отметкой отмены ищем через CheckOrder: ответ
      // её Init мог потеряться, а форма в банке осталась.
      if (
        row.state === "failed" &&
        (row.kind !== "one_time" ||
          (!hasText(row.paymentId) &&
            (await findOpenBankCancel(prisma, row.id)) === null))
      )
        return { ok: true, value: true };
      let paymentId = row.paymentId;
      if (!hasText(paymentId)) {
        const candidates = await bank.order(row.id);
        // An empty answer starts or closes the absence window; neither sends another Init.
        if (candidates.length === 0) return await this.settleEmptyOrder(row.id);
        if (candidates.length !== 1 || !hasText(candidates[0]))
          return paymentFailure("provider_unavailable");
        paymentId = candidates[0];
      }
      const payment = await bank.state(paymentId);
      if (payment.OrderId !== row.id || payment.PaymentId !== paymentId)
        return paymentFailure("invalid_notification");
      const accepted = await this.accept(payment);
      if (!accepted.ok || sendCancel === "never") return accepted;
      return await this.cancelRetiredForm(bank, row.id, payment);
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "reconcile" },
        error,
        paymentFailure("provider_unavailable"),
      );
    }
  }

  /**
   * CheckOrder не нашёл платежей заказа без PaymentId. Первый такой ответ пишет `bank_order_empty`.
   * Попытку закрывает пустой ответ не раньше `bankPaymentAbsenceWindowMilliseconds` после него
   * и после создания покупки. Найденный за это время платёж даёт PaymentId, и попытка уходит
   * из этой ветки. Пока окно не прошло, исход остаётся неизвестным: `provider_unavailable`.
   */
  private async settleEmptyOrder(
    purchaseRef: string,
  ): Promise<PaymentResult<true>> {
    const settled = await this.dependencies.prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      await lockBillingPurchase(tx, purchaseRef);
      const row = await tx.billingPurchase.findUniqueOrThrow({
        where: { id: purchaseRef },
        select: { state: true, paymentId: true, createdAt: true },
      });
      // `sent` остаётся после аварии процесса во время Init: ответ Init не дольше
      // `bankTimeoutMs`, поэтому окно закрывает её так же, как `unknown`.
      if (
        row.paymentId !== null ||
        !["sent", "unknown", "failed"].includes(row.state)
      )
        return "waiting";
      const now = this.clock();
      const first = await tx.billingPaymentEvent.findUnique({
        where: { purchaseRef_kind: { purchaseRef, kind: bankOrderEmpty } },
        select: { occurredAt: true },
      });
      if (first === null) {
        await recordEventOnce(tx, purchaseRef, bankOrderEmpty, {}, now);
        return "waiting";
      }
      if (
        now.getTime() - first.occurredAt.getTime() <
          bankPaymentAbsenceWindowMilliseconds ||
        now.getTime() - row.createdAt.getTime() <
          bankPaymentAbsenceWindowMilliseconds
      )
        return "waiting";
      await recordBankPaymentAbsent(
        tx,
        purchaseRef,
        {
          reason: "check_order_empty",
          firstEmptyAt: first.occurredAt.toISOString(),
        },
        now,
      );
      return "closed";
    });
    return settled === "closed"
      ? { ok: true, value: true }
      : paymentFailure("provider_unavailable");
  }

  /**
   * Проход сверки. Выдача по подтверждённым оплатам и снятие прежних покупок с частичным
   * возвратом идут до первого запроса к банку и не ждут его. Строки для банка идут от давно не проверенных;
   * новая строка начинается, только пока `budget` не прерван. Непроверенные строки сохраняют
   * своё место и открывают следующий проход. Форму после отказа или снятия сверка спрашивает
   * по убывающему расписанию `bankRecheckSteps`.
   */
  async recover(
    limit = 50,
    budget?: AbortSignal,
  ): Promise<
    PaymentResult<{
      status: "ready" | "configuration_idle";
      inspected: number;
      deferred: number;
      applied: number;
      failed: number;
    }>
  > {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return paymentFailure("invalid_request");
    try {
      const { prisma, bank } = this.dependencies;
      let { applied, failed } = await this.fulfillConfirmedPayments(limit);
      await releaseLegacyRefundReviewPurchases(prisma, this.clock, limit);
      let idle = bank === undefined;
      const now = this.clock();
      const windowStart = new Date(
        now.getTime() - declinedPaymentRecheckMilliseconds,
      );
      const retiredForms =
        bank === undefined
          ? new Map<string, Date>()
          : await openRetiredForms(prisma, windowStart, now, limit);
      const rows = await prisma.billingPurchase.findMany({
        where:
          bank === undefined
            ? { state: "prepared", kind: { not: "one_time" } }
            : {
                refundReviewRequired: false,
                OR: [
                  { state: { in: inFlightStates } },
                  {
                    state: "failed",
                    kind: "one_time",
                    paymentId: { not: null },
                    createdAt: { gte: windowStart },
                    OR: [
                      { bankRecheckAt: null },
                      { bankRecheckAt: { lte: now } },
                    ],
                  },
                  { id: { in: [...retiredForms.keys()] } },
                ],
              },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take: limit,
      });
      let inspected = 0;
      for (const row of rows) {
        if (budget?.aborted === true) break;
        inspected += 1;
        const reconciled = await this.reconcile(row.id);
        if (!reconciled.ok) {
          if (reconciled.error.code === "method_unavailable") idle = true;
          else failed += 1;
        }
        // Проверенная строка уходит в конец очереди; форма после отказа ждёт свой шаг расписания.
        const checkedAt = this.clock();
        const markedAt = retiredForms.get(row.id);
        await prisma.billingPurchase.update({
          where: { id: row.id },
          data: {
            updatedAt: checkedAt,
            ...(row.state === "failed"
              ? {
                  bankRecheckAt: nextBankRecheck(
                    markedAt !== undefined && markedAt > row.createdAt
                      ? markedAt
                      : row.createdAt,
                    checkedAt,
                  ),
                }
              : {}),
          },
        });
      }
      if (bank !== undefined)
        await confirmReleasedLinkReservations(prisma, limit);
      // Оплата, которую банк подтвердил в этом проходе, получает доступ сразу, если бюджет остался.
      if (budget?.aborted !== true) {
        const late = await this.fulfillConfirmedPayments(limit);
        applied += late.applied;
        failed += late.failed;
      }
      return {
        ok: true,
        value: {
          status: idle ? "configuration_idle" : "ready",
          inspected,
          deferred: rows.length - inspected,
          applied,
          failed,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "recover" },
        error,
        paymentFailure("dependency_unavailable"),
      );
    }
  }

  /** Выдача доступа по подтверждённым оплатам из очереди выдачи. Банк она не спрашивает. */
  private async fulfillConfirmedPayments(
    limit: number,
  ): Promise<{ applied: number; failed: number }> {
    let applied = 0;
    let failed = 0;
    const pending = await this.dependencies.prisma.billingFulfillment.findMany({
      where: {
        appliedAt: null,
        reviewRequiredAt: null,
        nextAttemptAt: { lte: this.clock() },
      },
      orderBy: [{ nextAttemptAt: "asc" }, { eventRef: "asc" }],
      take: limit,
    });
    for (const row of pending) {
      // A failed item moves behind other work; a process crash leaves it recoverable after a minute.
      await this.dependencies.prisma.billingFulfillment.update({
        where: { eventRef: row.eventRef },
        data: {
          nextAttemptAt: new Date(
            this.clock().getTime() + fulfillmentRetryDelayMilliseconds,
          ),
        },
      });
      const purchase =
        await this.dependencies.prisma.billingPurchase.findUnique({
          where: { id: row.purchaseRef },
        });
      if (purchase === null) {
        failed += 1;
        continue;
      }
      if (purchase.kind !== "one_time") {
        // Historical recurring facts remain readable but can never issue a new right or charge.
        await this.dependencies.prisma.billingFulfillment.update({
          where: { eventRef: row.eventRef },
          data: { appliedAt: this.clock() },
        });
        continue;
      }
      const snapshot = priceSnapshotSchema.parse(purchase.snapshot);
      const productIds = savedContentProductIds(snapshot);
      if (productIds.length === 0 || purchase.confirmedAt === null) {
        const reason =
          productIds.length === 0
            ? "historical_scope_unresolved"
            : "capture_time_unresolved";
        await this.requireFulfillmentReview(
          purchase.id,
          row.eventRef,
          reason,
          snapshot,
        );
        continue;
      }
      let outcome: "applied" | "failed" | "account_deleted" = "applied";
      for (const productId of productIds) {
        const result = await this.dependencies.grants.issueProductAccess(
          { source: "purchase" },
          {
            accountId: purchase.accountId,
            productId,
            sourceRef:
              productIds.length === 1
                ? `payment:${purchase.id}`
                : `payment:${purchase.id}:product:${productId}`,
            issuedAt: purchase.confirmedAt.toISOString(),
            reason: "payment_confirmed",
          },
        );
        if (!result.ok) {
          // Выдаче по покупке Account Rights отвечает `not_found`, только если аккаунта нет.
          outcome =
            result.error.code === "not_found" ? "account_deleted" : "failed";
          break;
        }
      }
      if (outcome === "applied") {
        await this.dependencies.prisma.billingFulfillment.update({
          where: { eventRef: row.eventRef },
          data: { appliedAt: this.clock() },
        });
        applied += 1;
      } else if (outcome === "account_deleted")
        // Повтор выдачи удалённому аккаунту не поможет: решение о деньгах принимает владелец.
        await this.requireFulfillmentReview(
          purchase.id,
          row.eventRef,
          outcome,
          snapshot,
        );
      else failed += 1;
    }
    return { applied, failed };
  }

  /**
   * Выдача доступа не может завершиться без владельца: историческую покупку не удаётся сопоставить
   * с продуктом или аккаунт покупателя удалён. Строка выдачи получает отметку проверки и больше
   * не повторяется, а покупка один раз получает событие `fulfillment_review_required`. Строка без
   * `applied_at` держит сигнал сторожа «Выдача доступа».
   */
  private async requireFulfillmentReview(
    purchaseRef: string,
    eventRef: string,
    reason:
      | "historical_scope_unresolved"
      | "capture_time_unresolved"
      | "account_deleted",
    snapshot: PriceSnapshot,
  ): Promise<void> {
    await this.dependencies.prisma.$transaction(async (tx) => {
      await lockBillingPurchase(tx, purchaseRef);
      const current = await tx.billingFulfillment.findUniqueOrThrow({
        where: { eventRef },
      });
      if (current.appliedAt !== null || current.reviewRequiredAt !== null)
        return;
      const now = this.clock();
      await tx.billingFulfillment.update({
        where: { eventRef },
        data: { reviewRequiredAt: now, reviewReason: reason },
      });
      // Old purchases may have one outbox row per benefit. The purchase event is immutable;
      // each row still needs its own terminal review marker, including later-arriving rows.
      await recordEventOnce(
        tx,
        purchaseRef,
        "fulfillment_review_required",
        {
          reason,
          savedBenefits: snapshot.offer.benefits,
          savedCoverage: snapshot.offer.coverage ?? null,
        },
        now,
      );
    });
  }

  /**
   * Снятая в Inside попытка с открытой отметкой отмены и неоплаченной формой отменяется в банке.
   * Запрос идёт вне транзакции. Если отмена не удалась, сверка повторяет её, пока банк не
   * подтвердит `CANCELED`, а восстановление спрашивает банк о такой попытке сутки после отметки.
   * Если покупатель успел оплатить форму, оплата принимается обычным путём и отмечается как
   * вторая. Если он оплатил её между GetState и Cancel, банк вернёт деньги: это фиксирует
   * `bank_cancel_returned_payment`, а сам возврат примет следующая сверка.
   */
  private async cancelRetiredForm(
    bank: Tbank,
    purchaseRef: string,
    observed: BankPayment,
  ): Promise<PaymentResult<true>> {
    const { prisma } = this.dependencies;
    if (!unpaidFormStatuses.includes(observed.Status))
      return { ok: true, value: true };
    const row = await prisma.billingPurchase.findUnique({
      where: { id: purchaseRef },
      select: { state: true, kind: true, paymentId: true },
    });
    if (
      row?.state !== "failed" ||
      row.kind !== "one_time" ||
      row.paymentId !== observed.PaymentId
    )
      return { ok: true, value: true };
    if ((await findOpenBankCancel(prisma, purchaseRef)) === null)
      return { ok: true, value: true };
    const cancelled = await bank.cancel({
      orderId: purchaseRef,
      paymentId: row.paymentId,
    });
    if (!cancelled.sent) return await this.accept(cancelled.payment);
    const { result } = cancelled;
    if (
      !result.Success ||
      result.ErrorCode !== "0" ||
      (result.Status !== "CANCELED" &&
        !(refundTerminalStatuses as readonly string[]).includes(result.Status))
    )
      return dependencyFailure(
        { module: "billing", operation: "reconcile" },
        new Error(
          `Bank Cancel answered ${result.Status} with error ${result.ErrorCode}`,
        ),
        paymentFailure("provider_unavailable"),
      );
    await prisma.$transaction(async (tx) => {
      await lockBillingPurchase(tx, purchaseRef);
      const now = this.clock();
      if (result.Status === "CANCELED") {
        await closeBankCancel(
          tx,
          purchaseRef,
          result.PaymentId,
          "CANCELED",
          now,
        );
        return;
      }
      await recordEventOnce(
        tx,
        purchaseRef,
        bankCancelReturnedPayment,
        { paymentId: result.PaymentId, status: result.Status },
        now,
      );
    });
    return { ok: true, value: true };
  }

  /** Закрытие сроков идёт отдельно от списаний, в том числе при простое терминала. */
  private async awaitBankAnswer(attemptRef: string): Promise<void> {
    const deadline = Date.now() + inFlightAnswerBudgetMilliseconds;
    for (;;) {
      const row = await this.dependencies.prisma.billingPurchase.findUnique({
        where: { id: attemptRef },
        select: { state: true },
      });
      if (row?.state !== "sent" || Date.now() >= deadline) return;
      await delay(inFlightAnswerPollMilliseconds);
    }
  }

  async dispatch(
    attemptRef: string,
  ): Promise<
    "dispatched" | "skipped" | "failed" | "configuration_idle" | "already_owned"
  > {
    const { prisma, bank } = this.dependencies;
    if (!bank) return "configuration_idle";
    const prepared = await prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      const row = await tx.billingPurchase.findUnique({
        where: { id: attemptRef },
      });
      if (
        row?.state !== "prepared" ||
        row.terminalRef !== bank.config.terminalKey ||
        row.environment !== bank.config.environment
      )
        return undefined;
      const kind = attemptKindSchema.parse(row.kind);
      // Prepared proves Init has not been sent: retirement releases the reservation and takes no
      // money. The event marks the retirement in the owner's payment card; its reason reaches
      // the buyer through the purchase status and the owner through the log line.
      const retire = async (reason: RetirementReason) => {
        const now = this.clock();
        await tx.billingPurchase.update({
          where: { id: attemptRef },
          data: {
            state: "failed",
            lifecycleActive: false,
            paymentUrl: null,
            updatedAt: now,
          },
        });
        if (isQuotedPurchase(kind))
          await tx.billingPromoReservation.updateMany({
            where: { purchaseRef: attemptRef },
            data: { state: "failed" },
          });
        await tx.billingPaymentEvent.create({
          data: {
            id: randomUUID(),
            purchaseRef: attemptRef,
            kind: dispatchRetiredEvent,
            payload: { reason },
            occurredAt: now,
            recordedAt: now,
          },
        });
        return { status: "retired", reason } as const;
      };
      if (
        !z
          .object({ commercialModel: z.literal("product-lifetime-v1") })
          .safeParse(row.acceptance).success ||
        !isQuotedPurchase(kind) ||
        paymentMode(priceSnapshotSchema.parse(row.snapshot).paymentOption) !==
          "one_time"
      )
        // An obsolete subscription attempt cannot block a later one-time Product purchase.
        return await retire("unsupported_attempt");
      const snapshot = priceSnapshotSchema.parse(row.snapshot);
      const productId =
        snapshot.product?.id ??
        snapshot.offer.benefits
          .filter(isProductCapability)
          .map(productIdFromCapability)[0];
      const current =
        typeof productId === "string"
          ? await tx.billingProductPrice.findUnique({ where: { productId } })
          : null;
      // Покупка по ссылке на оплату не зависит от публикации цены: снятие с публикации убирает
      // цену только с витрины. Архив цены и продукта закрывает продажу на всех путях.
      if (
        current?.archived === true ||
        !(await productSaleAvailable(
          this.dependencies.contentCatalog,
          snapshot,
          transactionHandle(tx),
        ))
      )
        return await retire("sale_closed");
      if (
        current === null ||
        (!current.published && snapshot.individualPayment === undefined)
      )
        return await retire("price_unavailable");
      await lockAccountEntitlementChanges(tx, row.accountId);
      const acquired = await this.dependencies.grants.hasProductAcquisition(
        row.accountId,
        current.productId,
        transactionHandle(tx),
      );
      if (!acquired.ok)
        throw new Error("Current Product acquisition is unavailable");
      if (acquired.acquired) return await retire("already_owned");
      const now = this.clock();
      await tx.billingPurchase.update({
        where: { id: attemptRef },
        data: { state: "sent", updatedAt: now },
      });
      if (isQuotedPurchase(kind))
        await tx.billingPromoReservation.update({
          where: { purchaseRef: attemptRef },
          data: { state: "sent" },
        });
      return { status: "prepared", row, kind } as const;
    });
    if (!prepared) return "skipped";
    if (prepared.status === "retired") {
      // Written after commit: a rolled-back retirement never reaches the log.
      writeLog("warn", "billing_dispatch_retired", {
        module: "billing",
        operation: "dispatch",
        purchaseRef: attemptRef,
        reason: prepared.reason,
      });
      return prepared.reason === "already_owned" ? "already_owned" : "skipped";
    }
    const { row, kind } = prepared;
    // До вызова Init банк заказа не видел: сбой подготовки закрывает попытку без платежа.
    let initRequested = false;
    try {
      const snapshot = priceSnapshotSchema.parse(row.snapshot);
      const email = openOrderEmail(bank, row.id, row.contact);
      const products =
        kind === "one_time"
          ? await this.dependencies.contentCatalog?.resolve(
              snapshot.offer.coverage ?? {
                productIds: snapshot.offer.benefits
                  .filter(isProductCapability)
                  .map(
                    (value) =>
                      productIdFromCapability(
                        accessCapabilitySchema.parse(value),
                      ) ?? "",
                  ),
                materialIds: [],
              },
            )
          : undefined;
      const product = products?.filter((entry) => entry.kind === "product");
      const returnSlug = product?.length === 1 ? product[0]?.slug : null;
      initRequested = true;
      const payment = await bank.init({
        orderId: row.id,
        accountId: row.accountId,
        amount: Number(row.amountKopecks),
        name: snapshot.offer.name,
        email,
        ...(snapshot.individualPayment !== undefined
          ? {
              returnPath: `/payment/links/${snapshot.individualPayment.linkId}`,
            }
          : returnSlug == null
            ? {}
            : {
                returnPath: `/products/${encodeURIComponent(returnSlug)}/buy`,
              }),
      });
      const accepted = await this.accept(
        payment,
        isQuotedPurchase(kind) ? payment.PaymentURL : undefined,
      );
      if (!accepted.ok) throw new Error("Bank initialization fact rejected");
      return "dispatched";
    } catch (error) {
      reportDependencyFailure(
        { module: "billing", operation: "dispatch" },
        error,
      );
      const absence = initAbsence(error, initRequested);
      await prisma.$transaction(async (tx) => {
        await lockBillingPricing(tx);
        if (absence !== null) {
          await recordBankPaymentAbsent(tx, row.id, absence, this.clock());
          return;
        }
        // Сеть, таймаут, HTTP-ошибка или ответ не по схеме: платёж мог появиться, исход решит сверка.
        const changed = await tx.billingPurchase.updateMany({
          where: { id: row.id, state: { in: ["sent", "pending"] } },
          data: { state: "unknown", updatedAt: this.clock() },
        });
        if (changed.count > 0 && isQuotedPurchase(kind))
          await tx.billingPromoReservation.update({
            where: { purchaseRef: attemptRef },
            data: { state: "unknown" },
          });
      });
      return "failed";
    }
  }

  private async accept(
    payment: BankPayment,
    paymentUrl?: string,
  ): Promise<PaymentResult<true>> {
    const { prisma, bank } = this.dependencies;
    if (!bank) return paymentFailure("method_unavailable");
    if (!z.uuid().safeParse(payment.OrderId).success)
      return paymentFailure("invalid_notification");
    try {
      return await prisma.$transaction(async (tx) => {
        await lockBillingPricing(tx);
        await lockBillingPurchase(tx, payment.OrderId);
        const row = await tx.billingPurchase.findUnique({
          where: { id: payment.OrderId },
        });
        if (
          !row ||
          row.environment !== bank.config.environment ||
          row.terminalRef !== payment.TerminalKey ||
          row.terminalRef !== bank.config.terminalKey ||
          (!partialReturnStatuses.includes(payment.Status) &&
            Number(row.amountKopecks) !== payment.Amount) ||
          (row.paymentId !== null && row.paymentId !== payment.PaymentId) ||
          row.state === "prepared"
        )
          return paymentFailure("invalid_notification");
        const now = this.clock();
        const kind = attemptKindSchema.parse(row.kind);
        // Подписанный статус вне справочника банка виден владельцу; покупку ниже решает сверка.
        if (!isRecognizedBankStatus(payment.Status))
          await recordEventOnce(
            tx,
            row.id,
            "bank_status_unrecognized",
            { paymentId: payment.PaymentId, status: payment.Status },
            now,
          );

        if (payment.Status === "RECEIPT") {
          const fiscalization =
            payment.Success && payment.ErrorCode === "0"
              ? "confirmed"
              : "failed";
          // A receipt is never a payment proof. A late failure cannot overwrite confirmed fiscalization.
          if (row.fiscalization !== "confirmed")
            await tx.billingPurchase.update({
              where: { id: row.id },
              data: { fiscalization },
            });
          const kind = `fiscalization_${fiscalization}`;
          if (
            !(await tx.billingPaymentEvent.findUnique({
              where: { purchaseRef_kind: { purchaseRef: row.id, kind } },
            }))
          ) {
            const observedAt = this.clock();
            await tx.billingPaymentEvent.create({
              data: {
                id: randomUUID(),
                purchaseRef: row.id,
                kind,
                payload: {
                  paymentId: payment.PaymentId,
                  amountKopecks: payment.Amount,
                  errorCode: payment.ErrorCode,
                },
                occurredAt: observedAt,
                recordedAt: observedAt,
              },
            });
          }
          return { ok: true, value: true };
        }
        if (partialReturnStatuses.includes(payment.Status)) {
          if (!payment.Success || payment.ErrorCode !== "0")
            return paymentFailure("invalid_notification");
          // The authenticated status is known. Its Amount is NOT an authoritative refunded sum.
          // Preserve the observation and stop automatic reconciliation until owning evidence resolves it.
          const observation = {
            status: payment.Status,
            paymentId: payment.PaymentId,
            orderId: payment.OrderId,
            observedAmountKopecks: payment.Amount,
            resolution: "amount_unresolved",
          };
          const kind = `partial_refund_observed:${createHash("sha256").update(JSON.stringify(observation)).digest("hex")}`;
          if (
            !(await tx.billingPaymentEvent.findUnique({
              where: { purchaseRef_kind: { purchaseRef: row.id, kind } },
            }))
          ) {
            await tx.billingPaymentEvent.create({
              data: {
                id: randomUUID(),
                purchaseRef: row.id,
                kind,
                payload: observation,
                occurredAt: now,
                recordedAt: now,
              },
            });
            const fullRefundKnown = await tx.billingPaymentEvent.findUnique({
              where: {
                purchaseRef_kind: {
                  purchaseRef: row.id,
                  kind: "full_refund_confirmed",
                },
              },
            });
            if (fullRefundKnown === null) {
              await tx.billingPurchase.update({
                where: { id: row.id },
                data: { refundReviewRequired: true },
              });
              if (row.state !== "confirmed")
                await releaseForRefundReview(tx, row.id, row.state, now);
            }
          }
          return { ok: true, value: true };
        }
        const refunded = payment.Status === "REFUNDED";
        if (refunded && (!payment.Success || payment.ErrorCode !== "0"))
          return paymentFailure("invalid_notification");
        if (row.state === "confirmed") {
          if (refunded) await acceptBankRefund(tx, row, now);
          return { ok: true, value: true };
        }
        // Подтверждение того же PaymentId сильнее прежнего отказа: деньги списаны, покупка оплачена.
        // Исторические попытки подписки так не оживают: их механика снята с продажи.
        if (row.state === "failed") {
          if (payment.Status !== "CONFIRMED" && !refunded) {
            // Ответ Init снятой попытки может прийти уже после снятия. PaymentId нужен,
            // чтобы сверка нашла этот платёж и отменила его форму в банке.
            if (row.paymentId === null && kind === "one_time")
              await tx.billingPurchase.update({
                where: { id: row.id },
                data: { paymentId: payment.PaymentId },
              });
            await closeBankCancel(
              tx,
              row.id,
              payment.PaymentId,
              payment.Status,
              now,
            );
            return { ok: true, value: true };
          }
          if (kind !== "one_time")
            return paymentFailure("invalid_notification");
        }
        const common = {
          paymentId: payment.PaymentId,
          updatedAt: now,
        };
        // Отметку без снятия получает только попытка с неизвестным исходом.
        const cancelMark =
          row.state === "unknown" &&
          kind === "one_time" &&
          unpaidFormStatuses.includes(payment.Status)
            ? await findOpenBankCancel(tx, row.id)
            : null;
        if (payment.Status === "CONFIRMED" || refunded) {
          if (!payment.Success || payment.ErrorCode !== "0")
            return paymentFailure("invalid_notification");
          // A verified full refund also proves prior capture when CONFIRMED delivery was lost.
          // Payment fulfillment and the independent refund fact commit together.
          const paidAt = now;
          const eventRef = randomUUID();
          const snapshot = priceSnapshotSchema.parse(row.snapshot);
          const confirmedPurchase = await tx.billingPurchase.update({
            where: { id: row.id },
            data: {
              ...common,
              state: "confirmed",
              confirmedAt: paidAt,
              periodEndsAt: null,
              paymentUrl: null,
            },
          });
          const reservation = isQuotedPurchase(kind)
            ? await tx.billingPromoReservation.findUnique({
                where: { purchaseRef: row.id },
                select: { state: true, paymentLinkId: true },
              })
            : null;
          // Отказ мог остаться и только в резерве: до #1929 частичный возврат переводил отказанную
          // покупку в unknown, а резерв оставался failed.
          const reservationConfirmed =
            row.state === "failed" || reservation?.state === "failed"
              ? await settleConfirmationAfterFailure(
                  tx,
                  row,
                  snapshot,
                  reservation?.paymentLinkId ?? null,
                  now,
                )
              : true;
          if (reservation !== null && reservationConfirmed)
            await tx.billingPromoReservation.update({
              where: { purchaseRef: row.id },
              data: { state: "confirmed" },
            });
          // Деньги, которые уже вернул опоздавший Cancel, не ждут решения владельца о возврате.
          const returnedByCancel =
            refunded &&
            (await tx.billingPaymentEvent.findUnique({
              where: {
                purchaseRef_kind: {
                  purchaseRef: row.id,
                  kind: bankCancelReturnedPayment,
                },
              },
              select: { id: true },
            })) !== null;
          if (kind === "one_time" && !returnedByCancel)
            await recordDuplicatePayment(
              tx,
              this.dependencies.grants,
              row,
              snapshot,
              reservation?.paymentLinkId ?? null,
              now,
            );
          await closeBankCancel(
            tx,
            row.id,
            payment.PaymentId,
            payment.Status,
            now,
          );
          await tx.billingPaymentEvent.create({
            data: {
              id: eventRef,
              purchaseRef: row.id,
              kind: "payment_confirmed",
              payload: {
                accountId: row.accountId,
                amountKopecks: payment.Amount,
                periodRef: row.id,
                startsAt: paidAt.toISOString(),
                endsAt: null,
                snapshot,
              },
              occurredAt: paidAt,
              recordedAt: now,
            },
          });
          // Подтверждённая оплата — повод сообщения; имя и сумма берутся из снимка самой операции.
          await recordBillingNotice(
            tx,
            {
              kind: "payment_succeeded",
              accountId: row.accountId,
              sourceRef: attemptSourceRef(row.id),
              attemptRef: row.id,
              title: snapshot.offer.name,
              amountKopecks: payment.Amount,
              ...lifecycleWindow(paidAt),
            },
            now,
          );
          if (kind === "one_time") {
            await tx.billingFulfillment.create({
              data: {
                eventRef,
                purchaseRef: row.id,
                payload: {
                  version: "product-access-v1",
                  accountId: row.accountId,
                  confirmedAt: paidAt.toISOString(),
                },
              },
            });
          }
          if (refunded) await acceptBankRefund(tx, confirmedPurchase, now);
        } else if (declinedStatuses.includes(payment.Status)) {
          await tx.billingPurchase.update({
            where: { id: row.id },
            data: {
              ...common,
              state: "failed",
              lifecycleActive: false,
              paymentUrl: null,
            },
          });
          if (isQuotedPurchase(kind)) {
            const released = await tx.billingPromoReservation.update({
              where: { purchaseRef: row.id },
              data: { state: "failed" },
              select: { paymentLinkId: true },
            });
            if (released.paymentLinkId !== null)
              await confirmWaitingLinkReservation(tx, released.paymentLinkId);
          }
          await closeBankCancel(
            tx,
            row.id,
            payment.PaymentId,
            payment.Status,
            now,
          );
        } else if (
          undecidedStatuses.includes(payment.Status) ||
          !isRecognizedBankStatus(payment.Status) ||
          !payment.Success ||
          payment.ErrorCode !== "0"
        ) {
          // An undecided, unrecognized or contradictory bank state requires reconciliation,
          // never a new charge.
          await tx.billingPurchase.update({
            where: { id: row.id },
            data: { ...common, state: "unknown", paymentUrl: null },
          });
        } else if (cancelMark !== null) {
          // Попытку с неизвестным исходом снимает только ответ банка о неоплаченной форме.
          await retireAttempt(tx, row.id, cancelMark, now, payment.PaymentId);
          await releaseRetiredLink(tx, row.id);
        } else {
          const authorized =
            row.state === "authorized" || payment.Status === "AUTHORIZED";
          const payable = unpaidFormStatuses.includes(payment.Status);
          await tx.billingPurchase.update({
            where: { id: row.id },
            data: {
              ...common,
              state: authorized ? "authorized" : "pending",
              ...(!payable || authorized ? { paymentUrl: null } : {}),
              ...(hasText(paymentUrl) && !authorized && payable
                ? {
                    paymentUrl: validatedPaymentUrl(
                      paymentUrl,
                      bank.config.endpoints.formOrigins,
                    ),
                  }
                : {}),
            },
          });
        }
        return { ok: true, value: true };
      });
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "accept" },
        error,
        paymentFailure("dependency_unavailable"),
      );
    }
  }
}

function purchaseAccess(
  state: string,
  waiting: number,
  ready: boolean,
  reviewRequired = false,
): PurchaseStatus["access"] {
  return state !== "confirmed"
    ? "awaiting_payment"
    : reviewRequired
      ? "review_required"
      : waiting > 0
        ? "preparing"
        : ready
          ? "ready"
          : "unavailable";
}

/** Only immutable content authority names Products. Support/community coverage does not. */
function savedContentProductIds(snapshot: PriceSnapshot): string[] {
  return [
    ...new Set(
      [
        ...snapshot.offer.benefits
          .filter(isProductCapability)
          .map(productIdFromCapability)
          .filter((id): id is string => id !== null),
        ...(snapshot.offer.benefits.includes("materials")
          ? (snapshot.offer.coverage?.productIds ?? [])
          : []),
      ].map((id) => id.toLowerCase()),
    ),
  ].sort();
}

function savedContentProductWhere(
  productId: string,
): Prisma.BillingPurchaseWhereInput {
  return {
    OR: [
      {
        snapshot: {
          path: ["offer", "benefits"],
          array_contains: [productCapability(productId)],
        },
      },
      {
        AND: [
          {
            snapshot: {
              path: ["offer", "benefits"],
              array_contains: ["materials"],
            },
          },
          {
            snapshot: {
              path: ["offer", "coverage", "productIds"],
              array_contains: [productId],
            },
          },
        ],
      },
    ],
  };
}

type PurchaseRow = Awaited<
  ReturnType<BillingPrisma["billingPurchase"]["findUniqueOrThrow"]>
>;

/** Незавершённая разовая покупка этого продукта у Account. */
function openAttemptWhere(
  accountId: string,
  productId: string,
): Prisma.BillingPurchaseWhereInput {
  return {
    accountId,
    kind: "one_time",
    state: { in: inFlightStates },
    ...savedContentProductWhere(productId),
  };
}

/** Новый расчёт назначает другую сумму или другую ссылку на оплату, чем открытая попытка. */
function pricedDifferently(
  attempt: Pick<PurchaseRow, "amountKopecks" | "snapshot">,
  snapshot: PriceSnapshot,
): boolean {
  return (
    Number(attempt.amountKopecks) !== snapshot.firstPriceKopecks ||
    priceSnapshotSchema.parse(attempt.snapshot).individualPayment?.linkId !==
      snapshot.individualPayment?.linkId
  );
}

/** Новая попытка не создана: снятие прежней откатывается вместе с транзакцией. */
class ReplacementRejected extends Error {
  constructor(readonly code: PaymentFailureCode) {
    super(`Price replacement rejected: ${code}`);
  }
}

/** Открытая попытка, которую снимает покупка по другой цене (#1925). */
interface ReplaceableAttempt {
  readonly id: string;
  /** `prepared`: Init не уходил, и форму в банке отменять не нужно. */
  readonly state: "prepared" | "pending";
}

/**
 * Что покупка делает с открытой попыткой того же продукта. Та же цена и оплаченная попытка:
 * `continue`. При другой цене (#1925) попытку `prepared` Init ещё не создал, и она снимается. Попытку `pending`
 * снимает только ответ банка о неоплаченной форме, полученный перед транзакцией. Если банк этого
 * не подтвердил, а у попытки есть или вот-вот появится форма по прежней цене (`sent` или `pending`
 * со ссылкой формы), ответ `unverified`. Удержанная попытка, попытка с неизвестным исходом и
 * `pending`, чью форму банк уже не принимает к оплате, получают `continue`: покупатель видит их
 * статус.
 * Вызывающий держит замок цен.
 */
async function decideOpenAttempt(
  tx: BillingPrisma,
  attempt: PurchaseRow,
  snapshot: PriceSnapshot,
  bankUnpaidAttemptRef: string | null,
): Promise<
  | { readonly kind: "replace"; readonly attempt: ReplaceableAttempt }
  | { readonly kind: "unverified" }
  | { readonly kind: "continue" }
> {
  if (attempt.state === "confirmed" || !pricedDifferently(attempt, snapshot))
    return { kind: "continue" };
  await lockBillingPurchase(tx, attempt.id);
  const { state, paymentUrl } = await tx.billingPurchase.findUniqueOrThrow({
    where: { id: attempt.id },
    select: { state: true, paymentUrl: true },
  });
  if (state === "prepared")
    return { kind: "replace", attempt: { id: attempt.id, state } };
  if (state === "pending" && attempt.id === bankUnpaidAttemptRef)
    return { kind: "replace", attempt: { id: attempt.id, state } };
  return state === "sent" || (state === "pending" && paymentUrl !== null)
    ? { kind: "unverified" }
    : { kind: "continue" };
}

/**
 * Покупка по другой цене снимает открытую попытку (#1925). Попытка, чей Init ушёл в банк,
 * получает отметку отмены: сверка закроет её форму. Ссылка снятой попытки освобождается.
 */
async function retireReplacedAttempt(
  tx: BillingPrisma,
  attempt: ReplaceableAttempt,
  replacementPurchaseRef: string,
  now: Date,
): Promise<void> {
  const retirement = {
    reason: "replaced_by_new_price",
    replacementPurchaseRef,
  } as const;
  if (attempt.state === "pending")
    await requireBankCancel(tx, attempt.id, retirement, now);
  await retireAttempt(tx, attempt.id, retirement, now);
  await releaseRetiredLink(tx, attempt.id);
}

/**
 * Банк подтвердил покупку, которую мы уже считали неуспешной. Пока она числилась неуспешной,
 * покупатель мог начать новую попытку того же продукта или занять ту же ссылку на оплату.
 * Неоплаченные попытки этого Account снимаются, чтобы он не заплатил дважды, а их формы в банке
 * получают отметку отмены. Попытку с неизвестным исходом сверка сначала сверяет с банком. Ответ `false`
 * значит, что ссылку держит другая попытка: резерв этой покупки остаётся неуспешным. Вторая
 * оплаченная покупка того же продукта или той же ссылки получает событие для решения владельца.
 */
async function settleConfirmationAfterFailure(
  tx: BillingPrisma,
  row: PurchaseRow,
  snapshot: PriceSnapshot,
  paymentLinkId: string | null,
  now: Date,
): Promise<boolean> {
  const linkHolders =
    paymentLinkId === null
      ? []
      : (
          await tx.billingPromoReservation.findMany({
            where: linkHolderWhere(paymentLinkId, row.id),
            select: { purchaseRef: true },
          })
        ).map((holder) => holder.purchaseRef);
  const scope = relatedPurchaseScope(row, snapshot, linkHolders);
  const related =
    scope.length === 0
      ? []
      : await tx.billingPurchase.findMany({
          where: { id: { not: row.id }, kind: "one_time", OR: scope },
          select: { id: true, accountId: true, state: true },
        });
  const superseded: string[] = [];
  for (const attempt of related) {
    if (
      attempt.accountId !== row.accountId ||
      (!supersedableStates.includes(attempt.state) &&
        attempt.state !== "unknown")
    )
      continue;
    await lockBillingPurchase(tx, attempt.id);
    const { state } = await tx.billingPurchase.findUniqueOrThrow({
      where: { id: attempt.id },
      select: { state: true },
    });
    // Init ушёл или мог уйти в банк у всех, кроме prepared: такую форму сверка отменит.
    const retirement = {
      reason: "superseded_by_confirmed_payment",
      confirmedPurchaseRef: row.id,
    } as const;
    if (state === "sent" || state === "pending" || state === "unknown")
      await requireBankCancel(tx, attempt.id, retirement, now);
    // Неизвестный исход ждёт ответа банка: сверка снимет попытку, если форма не оплачена.
    if (!supersedableStates.includes(state)) continue;
    await retireAttempt(tx, attempt.id, retirement, now);
    superseded.push(attempt.id);
  }
  const remainingHolders = linkHolders.filter(
    (ref) => !superseded.includes(ref),
  );
  const reservation =
    remainingHolders.length === 0
      ? "confirmed"
      : related.some(
            (attempt) =>
              attempt.state === "confirmed" &&
              remainingHolders.includes(attempt.id),
          )
        ? "payment_link_paid"
        : "payment_link_in_use";
  await tx.billingPaymentEvent.create({
    data: {
      id: randomUUID(),
      purchaseRef: row.id,
      kind: "payment_confirmed_after_failure",
      payload: { supersededPurchaseRefs: superseded, reservation },
      occurredAt: now,
      recordedAt: now,
    },
  });
  return remainingHolders.length === 0;
}

/**
 * Inside снимает неоплаченную попытку: она закрывается вместе с резервом и получает событие с
 * именем причины, `superseded_by_confirmed_payment` или `replaced_by_new_price`. Вызывающий
 * держит замок покупки.
 */
async function retireAttempt(
  tx: BillingPrisma,
  attemptRef: string,
  retirement: Retirement,
  now: Date,
  paymentId?: string,
): Promise<void> {
  await tx.billingPurchase.update({
    where: { id: attemptRef },
    data: {
      state: "failed",
      lifecycleActive: false,
      paymentUrl: null,
      updatedAt: now,
      ...(paymentId === undefined ? {} : { paymentId }),
    },
  });
  await tx.billingPromoReservation.updateMany({
    where: { purchaseRef: attemptRef },
    data: { state: "failed" },
  });
  const { reason, ...payload } = retirement;
  await recordEventOnce(tx, attemptRef, reason, payload, now);
}

/**
 * Снятые попытки с открытой отметкой отмены за последние сутки, чей шаг опроса уже наступил, и
 * время их отметки. Форма живёт сутки от Init, а Init уходит до отметки, поэтому окно от отметки
 * накрывает весь срок формы. Попытка без PaymentId тоже входит: ответ её Init мог потеряться, и
 * платёж ищет CheckOrder. Не больше `limit`.
 */
async function openRetiredForms(
  prisma: BillingPrismaClient,
  markedSince: Date,
  now: Date,
  limit: number,
): Promise<Map<string, Date>> {
  const rows = z
    .array(z.object({ purchase_ref: z.uuid(), marked_at: z.date() }))
    .parse(
      await prisma.$queryRaw(Prisma.sql`
        SELECT required.purchase_ref, required.occurred_at AS marked_at
        FROM billing.payment_events required
        JOIN billing.purchases purchase ON purchase.id = required.purchase_ref
        WHERE required.kind = ${bankCancelRequested}
          AND required.occurred_at >= ${markedSince}
          AND purchase.state = 'failed'
          AND purchase.kind = 'one_time'
          AND (purchase.bank_recheck_at IS NULL OR purchase.bank_recheck_at <= ${now})
          AND NOT EXISTS (
            SELECT 1 FROM billing.payment_events closed
            WHERE closed.purchase_ref = required.purchase_ref
              AND closed.kind IN (${Prisma.join(bankCancelClosingEvents)})
          )
        ORDER BY purchase.updated_at, purchase.id
        LIMIT ${limit}
      `),
    );
  return new Map(rows.map((row) => [row.purchase_ref, row.marked_at]));
}

/** Следующий запрос к банку о форме, которая ждёт оплаты с момента `since`. */
function nextBankRecheck(since: Date, now: Date): Date {
  const age = now.getTime() - since.getTime();
  const step = bankRecheckSteps.find(
    (candidate) => age < candidate.ageBelowMilliseconds,
  );
  return new Date(
    now.getTime() +
      (step?.everyMilliseconds ?? finalBankRecheckEveryMilliseconds),
  );
}

/**
 * Частичный возврат по неподтверждённой покупке (#1929). Сумма возврата не доказана, и сверка такую
 * покупку не опрашивает. Чтобы она не держала продукт и ссылку на оплату, покупка закрывается
 * вместе с резервом. Событие `partial_refund_released` ведёт владельца к решению о деньгах: оно
 * попадает в фильтр проверки и в сторож. Признак `refundReviewRequired` остаётся до этого решения.
 * Вызывающий держит замки цен и покупки.
 */
async function releaseForRefundReview(
  tx: BillingPrisma,
  purchaseRef: string,
  previousState: string,
  now: Date,
): Promise<void> {
  if (previousState !== "failed") {
    await tx.billingPurchase.update({
      where: { id: purchaseRef },
      data: { state: "failed", paymentUrl: null, updatedAt: now },
    });
    await tx.billingPromoReservation.updateMany({
      where: { purchaseRef },
      data: { state: "failed" },
    });
    await releaseRetiredLink(tx, purchaseRef);
  }
  await recordEventOnce(
    tx,
    purchaseRef,
    partialRefundReleased,
    { previousState },
    now,
  );
}

/**
 * До #1929 частичный возврат оставлял неподтверждённую покупку в `unknown`, и она держала продукт
 * навсегда. Сверка снимает такие покупки так же, как теперь это делает приём уведомления.
 */
async function releaseLegacyRefundReviewPurchases(
  prisma: BillingPrismaClient,
  clock: () => Date,
  limit: number,
): Promise<void> {
  const rows = await prisma.billingPurchase.findMany({
    where: {
      kind: "one_time",
      refundReviewRequired: true,
      state: { in: inFlightStates },
    },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  for (const { id } of rows) {
    await prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      await lockBillingPurchase(tx, id);
      const current = await tx.billingPurchase.findUniqueOrThrow({
        where: { id },
        select: { state: true, kind: true, refundReviewRequired: true },
      });
      if (
        current.kind === "one_time" &&
        current.refundReviewRequired &&
        inFlightStates.includes(current.state)
      )
        await releaseForRefundReview(tx, id, current.state, clock());
    });
  }
}

/**
 * Причина снятия попытки: оплачена другая попытка того же продукта или ссылки, или покупатель
 * начал покупку по другой цене (#1925). Отметка отмены хранит ту же причину.
 */
const retirementSchema = z.discriminatedUnion("reason", [
  z.object({
    reason: z.literal("superseded_by_confirmed_payment"),
    confirmedPurchaseRef: z.uuid(),
  }),
  z.object({
    reason: z.literal("replaced_by_new_price"),
    replacementPurchaseRef: z.uuid(),
  }),
]);
type Retirement = z.infer<typeof retirementSchema>;

/** Отметка отмены: снятая попытка, чья форма в банке ещё может принять оплату. */
async function requireBankCancel(
  tx: BillingPrisma,
  attemptRef: string,
  retirement: Retirement,
  now: Date,
): Promise<void> {
  await recordEventOnce(
    tx,
    attemptRef,
    bankCancelRequested,
    retirementSchema.parse(retirement),
    now,
  );
}

/** Событие покупки этого вида пишется один раз. Вызывающий держит замок покупки. */
async function recordEventOnce(
  tx: BillingPrisma,
  purchaseRef: string,
  kind: string,
  payload: Prisma.InputJsonObject,
  now: Date,
): Promise<void> {
  const known = await tx.billingPaymentEvent.findUnique({
    where: { purchaseRef_kind: { purchaseRef, kind } },
    select: { id: true },
  });
  if (known !== null) return;
  await tx.billingPaymentEvent.create({
    data: {
      id: randomUUID(),
      purchaseRef,
      kind,
      payload,
      occurredAt: now,
      recordedAt: now,
    },
  });
}

/**
 * Сбой Init, после которого в банке точно нет платежа: Init не был вызван, адаптер не отправил
 * запрос или банк отказал без PaymentId. Иначе `null`: исход неизвестен.
 */
function initAbsence(
  error: unknown,
  initRequested: boolean,
): BankPaymentAbsence | null {
  if (!initRequested) return { reason: "init_not_sent" };
  if (!(error instanceof BankInitRefused)) return null;
  const { refusal } = error;
  return refusal.reason === "declined"
    ? {
        reason: "init_declined",
        errorCode: refusal.errorCode,
        message: refusal.message,
      }
    : { reason: "init_not_sent" };
}

/**
 * В банке нет платежа попытки. Попытка в `sent` или `unknown` закрывается вместе с резервом, и
 * покупатель может начать новую покупку. Снятая раньше попытка получает только событие: оно
 * закрывает её отметку отмены. Попытка с PaymentId или в другом состоянии не меняется.
 * Вызывающий держит замок цен.
 */
async function recordBankPaymentAbsent(
  tx: BillingPrisma,
  purchaseRef: string,
  absence: BankPaymentAbsence,
  now: Date,
): Promise<void> {
  await lockBillingPurchase(tx, purchaseRef);
  const row = await tx.billingPurchase.findUniqueOrThrow({
    where: { id: purchaseRef },
    select: { state: true, paymentId: true },
  });
  if (row.paymentId !== null) return;
  if (row.state === "sent" || row.state === "unknown") {
    await tx.billingPurchase.update({
      where: { id: purchaseRef },
      data: {
        state: "failed",
        lifecycleActive: false,
        paymentUrl: null,
        updatedAt: now,
      },
    });
    const released = await tx.billingPromoReservation.findUnique({
      where: { purchaseRef },
      select: { paymentLinkId: true },
    });
    if (released !== null) {
      await tx.billingPromoReservation.update({
        where: { purchaseRef },
        data: { state: "failed" },
      });
      if (released.paymentLinkId !== null)
        await confirmWaitingLinkReservation(tx, released.paymentLinkId);
    }
  } else if (row.state !== "failed") return;
  await recordEventOnce(tx, purchaseRef, bankPaymentAbsent, absence, now);
}

/** Открытая отметка отмены этой попытки или `null`. Запись по ответу идёт под замком покупки. */
async function findOpenBankCancel(
  tx: BillingPrisma,
  purchaseRef: string,
): Promise<Retirement | null> {
  const marks = await tx.billingPaymentEvent.findMany({
    where: {
      purchaseRef,
      kind: { in: [bankCancelRequested, ...bankCancelClosingEvents] },
    },
    select: { kind: true, payload: true },
  });
  if (marks.some((mark) => bankCancelClosingEvents.includes(mark.kind)))
    return null;
  const required = marks.find((mark) => mark.kind === bankCancelRequested);
  return required === undefined
    ? null
    : retirementSchema.parse(required.payload);
}

/**
 * Банк закрыл форму снятой попытки: Cancel или собственным статусом из `closedFormStatuses`.
 * Другой статус и попытка без открытой отметки ничего не пишут.
 */
async function closeBankCancel(
  tx: BillingPrisma,
  purchaseRef: string,
  paymentId: string,
  status: BankPayment["Status"],
  now: Date,
): Promise<void> {
  if (
    !closedFormStatuses.includes(status) ||
    (await findOpenBankCancel(tx, purchaseRef)) === null
  )
    return;
  await tx.billingPaymentEvent.create({
    data: {
      id: randomUUID(),
      purchaseRef,
      kind: bankCancelConfirmed,
      payload: { paymentId, status },
      occurredAt: now,
      recordedAt: now,
    },
  });
}

/**
 * Любое подтверждение разовой покупки проверяет вторую оплату: тот же Account уже оплатил этот
 * продукт, по той же ссылке уже есть оплаченная покупка или Account уже получил доступ к продукту
 * из любого источника (вручную, активацией Course, прежней покупкой), в том числе отозванный.
 * Деньги остаются подтверждёнными, событие ведёт владельца к решению о возврате. Доступ читается
 * через Account Rights в той же транзакции под замком изменений прав Account: выдача, начатая
 * параллельно, либо уже видна, либо ждёт конца этой транзакции.
 */
async function recordDuplicatePayment(
  tx: BillingPrisma,
  grants: Pick<AccessGrants, "hasProductAcquisition">,
  row: PurchaseRow,
  snapshot: PriceSnapshot,
  paymentLinkId: string | null,
  now: Date,
): Promise<void> {
  const linkPurchases =
    paymentLinkId === null
      ? []
      : (
          await tx.billingPromoReservation.findMany({
            where: { paymentLinkId, purchaseRef: { not: row.id } },
            select: { purchaseRef: true },
          })
        ).map((reservation) => reservation.purchaseRef);
  const scope = relatedPurchaseScope(row, snapshot, linkPurchases);
  const paid =
    scope.length === 0
      ? []
      : await tx.billingPurchase.findMany({
          where: {
            id: { not: row.id },
            kind: "one_time",
            state: "confirmed",
            OR: scope,
          },
          select: { id: true },
          orderBy: { id: "asc" },
        });
  const productIds = savedContentProductIds(snapshot);
  if (productIds.length > 0)
    await lockAccountEntitlementChanges(tx, row.accountId);
  const heldProductIds: string[] = [];
  for (const productId of productIds) {
    const acquisition = await grants.hasProductAcquisition(
      row.accountId,
      productId,
      transactionHandle(tx),
    );
    // Без ответа Account Rights вторую оплату не проверить: откат вернёт банку отказ, и он повторит.
    if (!acquisition.ok)
      throw new Error(
        `Product acquisition is unavailable: ${acquisition.error.code}`,
      );
    if (acquisition.acquired) heldProductIds.push(productId);
  }
  if (paid.length === 0 && heldProductIds.length === 0) return;
  await tx.billingPaymentEvent.create({
    data: {
      id: randomUUID(),
      purchaseRef: row.id,
      kind: "duplicate_payment_review",
      payload: {
        paidPurchaseRefs: paid.map((purchase) => purchase.id),
        heldProductIds,
      },
      occurredAt: now,
      recordedAt: now,
    },
  });
}

/**
 * Подтверждённая после отказа покупка оставила резерв неуспешным, пока ссылку держала другая
 * попытка. Когда держатель отпал, резерв подтверждается: иначе оплаченная ссылка выглядит
 * свободной и её можно оплатить ещё раз. Выборка видит только такие резервы и не больше `limit`.
 */
async function confirmReleasedLinkReservations(
  prisma: BillingPrismaClient,
  limit: number,
): Promise<void> {
  const rows = z.array(z.object({ purchase_ref: z.uuid() })).parse(
    await prisma.$queryRaw(Prisma.sql`
        SELECT reservation.purchase_ref
        FROM billing.promo_reservations reservation
        JOIN billing.purchases purchase ON purchase.id = reservation.purchase_ref
        WHERE reservation.state = 'failed'
          AND reservation.payment_link_id IS NOT NULL
          AND purchase.state = 'confirmed'
          AND purchase.kind = 'one_time'
          AND NOT EXISTS (
            SELECT 1 FROM billing.promo_reservations holder
            WHERE holder.payment_link_id = reservation.payment_link_id
              AND holder.purchase_ref <> reservation.purchase_ref
              AND holder.state <> 'failed'
          )
        ORDER BY reservation.purchase_ref
        LIMIT ${limit}
      `),
  );
  for (const { purchase_ref: purchaseRef } of rows) {
    await prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      await lockBillingPurchase(tx, purchaseRef);
      const reservation = await tx.billingPromoReservation.findUnique({
        where: { purchaseRef },
        select: { paymentLinkId: true },
      });
      if (reservation?.paymentLinkId != null)
        await confirmWaitingLinkReservation(tx, reservation.paymentLinkId);
    });
  }
}

/**
 * Ссылку отпустила последняя неотказанная попытка: резерв оплаченной покупки этой ссылки,
 * оставшийся неуспешным, подтверждается в той же транзакции. Вызывающий держит замок цен.
 */
async function confirmWaitingLinkReservation(
  tx: BillingPrisma,
  paymentLinkId: string,
): Promise<void> {
  const reservations = await tx.billingPromoReservation.findMany({
    where: { paymentLinkId },
    select: { purchaseRef: true, state: true },
  });
  if (reservations.some((reservation) => reservation.state !== "failed"))
    return;
  const waiting = await tx.billingPurchase.findFirst({
    where: {
      id: { in: reservations.map((reservation) => reservation.purchaseRef) },
      kind: "one_time",
      state: "confirmed",
    },
    orderBy: [{ confirmedAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (waiting === null) return;
  await tx.billingPromoReservation.update({
    where: { purchaseRef: waiting.id },
    data: { state: "confirmed" },
  });
}

/** Снятая попытка отпустила ссылку на оплату: ждущий резерв оплаченной покупки подтверждается. */
async function releaseRetiredLink(
  tx: BillingPrisma,
  attemptRef: string,
): Promise<void> {
  const released = await tx.billingPromoReservation.findUnique({
    where: { purchaseRef: attemptRef },
    select: { paymentLinkId: true },
  });
  if (released?.paymentLinkId != null)
    await confirmWaitingLinkReservation(tx, released.paymentLinkId);
}

/** Другая неотказанная попытка той же ссылки на оплату. */
function linkHolderWhere(
  paymentLinkId: string,
  purchaseRef: string,
): Prisma.BillingPromoReservationWhereInput {
  return {
    paymentLinkId,
    purchaseRef: { not: purchaseRef },
    state: { not: "failed" },
  };
}

/** Покупки того же Account по тому же продукту и покупки, занимавшие ту же ссылку. */
function relatedPurchaseScope(
  row: PurchaseRow,
  snapshot: PriceSnapshot,
  linkPurchaseRefs: readonly string[],
): Prisma.BillingPurchaseWhereInput[] {
  const productScope = savedContentProductIds(snapshot).map(
    savedContentProductWhere,
  );
  return [
    ...(productScope.length === 0
      ? []
      : [{ accountId: row.accountId, OR: productScope }]),
    ...(linkPurchaseRefs.length === 0
      ? []
      : [{ id: { in: [...linkPurchaseRefs] } }]),
  ];
}
