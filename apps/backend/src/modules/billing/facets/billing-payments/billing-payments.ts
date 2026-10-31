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
  purchaseStatusSchema,
  type PaymentResult,
  type PurchaseStatus,
} from "../../features/purchase-product/purchase-product.contract.js";
import { reservePurchaseInTransaction } from "../../features/reserve-purchase/reserve-purchase.js";
import {
  bankTimeoutMs,
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
/** Неоплаченная повторная попытка. Неизвестный исход и удержанные деньги остаются на сверке. */
const supersedableStates = ["prepared", "sent", "pending"];
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
              where: {
                accountId,
                kind: "one_time",
                state: { in: inFlightStates },
                ...savedContentProductWhere(
                  snapshot.product?.id ?? snapshot.paymentOption.id,
                ),
              },
              orderBy: { createdAt: "desc" },
            });
            if (continuingPurchase === null) {
              const confirmed = await tx.billingPurchase.findFirst({
                where: {
                  accountId,
                  kind: "one_time",
                  state: "confirmed",
                  ...savedContentProductWhere(
                    snapshot.product?.id ?? snapshot.paymentOption.id,
                  ),
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
            if (continuingPurchase) {
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
                snapshot.product?.id ?? snapshot.paymentOption.id,
                transactionHandle(tx),
              );
            if (!acquired.ok) return paymentFailure("dependency_unavailable");
            if (acquired.acquired) return paymentFailure("existing_access");
            const purchaseRef = randomUUID();
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
              return paymentFailure(
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
              return paymentFailure(admission.error.code);
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
      return dependencyFailure(
        { module: "billing", operation: "purchase" },
        error,
        paymentFailure("dependency_unavailable"),
      );
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
      const reconciled = await this.reconcile(purchaseRef);
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
      return {
        ok: true,
        value: purchaseStatusSchema.parse({
          purchaseRef,
          state: row.state,
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

  async reconcile(purchaseRef: string): Promise<PaymentResult<true>> {
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
      if (
        row.state === "failed" &&
        (row.kind !== "one_time" || !hasText(row.paymentId))
      )
        return { ok: true, value: true };
      let paymentId = row.paymentId;
      if (!hasText(paymentId)) {
        const candidates = await bank.order(row.id);
        // Empty/multiple results are uncertainty, not permission to send another Init.
        if (candidates.length !== 1 || !hasText(candidates[0]))
          return paymentFailure("provider_unavailable");
        paymentId = candidates[0];
      }
      const payment = await bank.state(paymentId);
      if (payment.OrderId !== row.id || payment.PaymentId !== paymentId)
        return paymentFailure("invalid_notification");
      const accepted = await this.accept(payment);
      return accepted;
    } catch (error) {
      return dependencyFailure(
        { module: "billing", operation: "reconcile" },
        error,
        paymentFailure("provider_unavailable"),
      );
    }
  }

  async recover(limit = 50): Promise<
    PaymentResult<{
      status: "ready" | "configuration_idle";
      inspected: number;
      applied: number;
      failed: number;
    }>
  > {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      return paymentFailure("invalid_request");
    try {
      let idle = this.dependencies.bank === undefined;
      let failed = 0;
      const rows = await this.dependencies.prisma.billingPurchase.findMany({
        where:
          this.dependencies.bank === undefined
            ? { state: "prepared", kind: { not: "one_time" } }
            : {
                refundReviewRequired: false,
                OR: [
                  { state: { in: inFlightStates } },
                  {
                    state: "failed",
                    kind: "one_time",
                    paymentId: { not: null },
                    createdAt: {
                      gte: new Date(
                        this.clock().getTime() -
                          declinedPaymentRecheckMilliseconds,
                      ),
                    },
                  },
                ],
              },
        orderBy: { updatedAt: "asc" },
        take: limit,
      });
      for (const row of rows) {
        const reconciled = await this.reconcile(row.id);
        if (!reconciled.ok) {
          if (reconciled.error.code === "method_unavailable") idle = true;
          else failed += 1;
        }
        await this.dependencies.prisma.billingPurchase.update({
          where: { id: row.id },
          data: { updatedAt: this.clock() },
        });
      }
      if (this.dependencies.bank !== undefined)
        await confirmReleasedLinkReservations(this.dependencies.prisma, limit);
      const pending =
        await this.dependencies.prisma.billingFulfillment.findMany({
          where: {
            appliedAt: null,
            reviewRequiredAt: null,
            nextAttemptAt: { lte: this.clock() },
          },
          orderBy: [{ nextAttemptAt: "asc" }, { eventRef: "asc" }],
          take: limit,
        });
      let applied = 0;
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
          await this.dependencies.prisma.$transaction(async (tx) => {
            await lockBillingPurchase(tx, purchase.id);
            const current = await tx.billingFulfillment.findUniqueOrThrow({
              where: { eventRef: row.eventRef },
            });
            if (current.appliedAt !== null || current.reviewRequiredAt !== null)
              return;
            const now = this.clock();
            await tx.billingFulfillment.update({
              where: { eventRef: row.eventRef },
              data: { reviewRequiredAt: now, reviewReason: reason },
            });
            const reviewEvent = await tx.billingPaymentEvent.findUnique({
              where: {
                purchaseRef_kind: {
                  purchaseRef: purchase.id,
                  kind: "fulfillment_review_required",
                },
              },
            });
            // Old purchases may have one outbox row per benefit. The purchase event is immutable;
            // each row still needs its own terminal review marker, including later-arriving rows.
            if (reviewEvent === null) {
              await tx.billingPaymentEvent.create({
                data: {
                  id: randomUUID(),
                  purchaseRef: purchase.id,
                  kind: "fulfillment_review_required",
                  payload: {
                    reason,
                    savedBenefits: snapshot.offer.benefits,
                    savedCoverage: snapshot.offer.coverage ?? null,
                  },
                  occurredAt: now,
                  recordedAt: now,
                },
              });
            }
          });
          continue;
        }
        let completed = true;
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
            completed = false;
            break;
          }
        }
        if (completed) {
          await this.dependencies.prisma.billingFulfillment.update({
            where: { eventRef: row.eventRef },
            data: { appliedAt: this.clock() },
          });
          applied += 1;
        } else failed += 1;
      }
      return {
        ok: true,
        value: {
          status: idle ? "configuration_idle" : "ready",
          inspected: rows.length,
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
      if (
        !z
          .object({ commercialModel: z.literal("product-lifetime-v1") })
          .safeParse(row.acceptance).success ||
        !isQuotedPurchase(kind) ||
        paymentMode(priceSnapshotSchema.parse(row.snapshot).paymentOption) !==
          "one_time"
      ) {
        // Prepared proves Init has not been sent. Release this reservation so an obsolete
        // subscription cannot block a later one-time Product purchase for the Account.
        await tx.billingPurchase.update({
          where: { id: attemptRef },
          data: {
            state: "failed",
            lifecycleActive: false,
            paymentUrl: null,
            updatedAt: this.clock(),
          },
        });
        if (isQuotedPurchase(kind))
          await tx.billingPromoReservation.updateMany({
            where: { purchaseRef: attemptRef },
            data: { state: "failed" },
          });
        return { status: "retired" } as const;
      }
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
        current === null ||
        current.archived ||
        (!current.published && snapshot.individualPayment === undefined) ||
        !(await productSaleAvailable(
          this.dependencies.contentCatalog,
          snapshot,
          transactionHandle(tx),
        ))
      ) {
        await tx.billingPurchase.update({
          where: { id: attemptRef },
          data: {
            state: "failed",
            lifecycleActive: false,
            paymentUrl: null,
            updatedAt: this.clock(),
          },
        });
        await tx.billingPromoReservation.updateMany({
          where: { purchaseRef: attemptRef },
          data: { state: "failed" },
        });
        return { status: "retired" } as const;
      }
      await lockAccountEntitlementChanges(tx, row.accountId);
      const acquired = await this.dependencies.grants.hasProductAcquisition(
        row.accountId,
        current.productId,
        transactionHandle(tx),
      );
      if (!acquired.ok)
        throw new Error("Current Product acquisition is unavailable");
      if (acquired.acquired) {
        await tx.billingPurchase.update({
          where: { id: attemptRef },
          data: {
            state: "failed",
            lifecycleActive: false,
            paymentUrl: null,
            updatedAt: this.clock(),
          },
        });
        await tx.billingPromoReservation.updateMany({
          where: { purchaseRef: attemptRef },
          data: { state: "failed" },
        });
        return { status: "already_owned" } as const;
      }
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
    if (prepared?.status === "retired") return "skipped";
    if (prepared?.status === "already_owned") return "already_owned";
    if (!prepared) return "skipped";
    const { row, kind } = prepared;
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
      await prisma.$transaction(async (tx) => {
        await lockBillingPricing(tx);
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
          (payment.Status !== "PARTIAL_REFUNDED" &&
            Number(row.amountKopecks) !== payment.Amount) ||
          (row.paymentId !== null && row.paymentId !== payment.PaymentId) ||
          row.state === "prepared"
        )
          return paymentFailure("invalid_notification");
        const now = this.clock();
        const kind = attemptKindSchema.parse(row.kind);

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
        if (payment.Status === "PARTIAL_REFUNDED") {
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
            if (fullRefundKnown === null)
              await tx.billingPurchase.update({
                where: { id: row.id },
                data: {
                  refundReviewRequired: true,
                  ...(row.state === "confirmed"
                    ? {}
                    : { state: "unknown", paymentUrl: null }),
                },
              });
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
          if (payment.Status !== "CONFIRMED" && !refunded)
            return { ok: true, value: true };
          if (kind !== "one_time")
            return paymentFailure("invalid_notification");
        }
        const common = {
          paymentId: payment.PaymentId,
          updatedAt: now,
        };
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
          // Отказ мог остаться и только в резерве: failed → PARTIAL_REFUNDED → unknown.
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
          if (kind === "one_time")
            await recordDuplicatePayment(
              tx,
              row,
              snapshot,
              reservation?.paymentLinkId ?? null,
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
        } else if (
          [
            "REJECTED",
            "AUTH_FAIL",
            "CANCELED",
            "DEADLINE_EXPIRED",
            "REVERSED",
          ].includes(payment.Status)
        ) {
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
        } else if (
          ["REVERSING", "REFUNDING", "PARTIAL_REFUNDED"].includes(
            payment.Status,
          ) ||
          !payment.Success ||
          payment.ErrorCode !== "0"
        ) {
          // An unsupported or contradictory bank state requires reconciliation, never a new charge.
          await tx.billingPurchase.update({
            where: { id: row.id },
            data: { ...common, state: "unknown", paymentUrl: null },
          });
        } else {
          const authorized =
            row.state === "authorized" || payment.Status === "AUTHORIZED";
          const payable =
            payment.Status === "NEW" || payment.Status === "FORM_SHOWED";
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

/**
 * Банк подтвердил покупку, которую мы уже считали неуспешной. Пока она числилась неуспешной,
 * покупатель мог начать новую попытку того же продукта или занять ту же ссылку на оплату.
 * Неоплаченные попытки этого Account снимаются, чтобы он не заплатил дважды. Ответ `false`
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
      !supersedableStates.includes(attempt.state)
    )
      continue;
    await lockBillingPurchase(tx, attempt.id);
    const retired = await tx.billingPurchase.updateMany({
      where: { id: attempt.id, state: { in: supersedableStates } },
      data: {
        state: "failed",
        lifecycleActive: false,
        paymentUrl: null,
        updatedAt: now,
      },
    });
    if (retired.count === 0) continue;
    superseded.push(attempt.id);
    await tx.billingPromoReservation.updateMany({
      where: { purchaseRef: attempt.id },
      data: { state: "failed" },
    });
    await tx.billingPaymentEvent.create({
      data: {
        id: randomUUID(),
        purchaseRef: attempt.id,
        kind: "superseded_by_confirmed_payment",
        payload: { confirmedPurchaseRef: row.id },
        occurredAt: now,
        recordedAt: now,
      },
    });
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
 * Любое подтверждение разовой покупки проверяет вторую оплату: тот же Account уже оплатил этот
 * продукт или по той же ссылке уже есть оплаченная покупка. Деньги остаются подтверждёнными,
 * событие ведёт владельца к решению о возврате.
 */
async function recordDuplicatePayment(
  tx: BillingPrisma,
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
  if (scope.length === 0) return;
  const paid = await tx.billingPurchase.findMany({
    where: {
      id: { not: row.id },
      kind: "one_time",
      state: "confirmed",
      OR: scope,
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (paid.length === 0) return;
  await tx.billingPaymentEvent.create({
    data: {
      id: randomUUID(),
      purchaseRef: row.id,
      kind: "duplicate_payment_review",
      payload: { paidPurchaseRefs: paid.map((purchase) => purchase.id) },
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
