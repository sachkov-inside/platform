import type { z } from "zod";
import type { BillingPrisma, BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import {
  auditEntryViewSchema, paymentEventViewSchema, paymentViewSchema, refundDecisionViewSchema,
  ownerFailure, type OwnerOperation, type OwnerOutcome, type OwnerResult,
} from "../../domain/owner-operations.js";
import { refundTotalsOf } from "../../shared/refund-amounts.js";

type PurchaseRow = Awaited<ReturnType<BillingPrisma["billingPurchase"]["findUniqueOrThrow"]>>;
type PaymentView = z.infer<typeof paymentViewSchema>;

/**
 * Владельческие виды платежей: банковское состояние, оплаченные условия, готовность доступа и
 * остаток к возврату. Незавершённая выдача и попытки возврата читаются одним запросом на страницу,
 * а не на строку. Сохранённые привязка, контакт и raw payload банка сюда не попадают.
 */
export async function paymentViews(tx: BillingPrisma, rows: readonly PurchaseRow[]): Promise<PaymentView[]> {
  if (rows.length === 0) return [];
  const purchaseRefs = rows.map(row => row.id);
  const [pending, refunds] = await Promise.all([
    tx.billingFulfillment.findMany({ where: { purchaseRef: { in: purchaseRefs }, appliedAt: null }, select: { purchaseRef: true } }),
    tx.billingRefund.findMany({ where: { purchaseRef: { in: purchaseRefs } }, select: { purchaseRef: true, state: true, amountKopecks: true } }),
  ]);
  return rows.map(row => {
    const totals = refundTotalsOf(refunds.filter(refund => refund.purchaseRef === row.id), row.amountKopecks);
    const waiting = pending.some(item => item.purchaseRef === row.id);
    return paymentViewSchema.parse({
      purchaseRef: row.id, accountId: row.accountId, kind: row.kind, state: row.state,
      subscriptionRef: row.subscriptionRef, periodIndex: row.periodIndex,
      amountKopecks: Number(row.amountKopecks), environment: row.environment, terminalRef: row.terminalRef,
      paymentId: row.paymentId, snapshot: row.snapshot, fiscalization: row.fiscalization,
      confirmedAt: row.confirmedAt?.toISOString() ?? null, periodEndsAt: row.periodEndsAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      access: row.state !== "confirmed" ? "awaiting_payment" : waiting ? "preparing" : "ready",
      refundedKopecks: totals.refundedKopecks, refundableKopecks: totals.refundableKopecks,
    });
  });
}

export async function paymentView(tx: BillingPrisma, row: PurchaseRow): Promise<PaymentView> {
  const [view] = await paymentViews(tx, [row]);
  if (view === undefined) throw new Error("Payment view is missing");
  return view;
}

export async function refundDecisionViews(tx: BillingPrisma, purchaseRef: string): Promise<z.infer<typeof refundDecisionViewSchema>[]> {
  const rows = await tx.billingRefundDecision.findMany({ where: { purchaseRef }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { refund: true } });
  return rows.map(row => refundDecisionViewSchema.parse({
    decisionRef: row.id, purchaseRef: row.purchaseRef, accountId: row.accountId, actorId: row.actorId,
    amountKopecks: Number(row.amountKopecks), access: row.access, recurring: row.recurring, reason: row.reason,
    state: row.state, revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    attempt: row.refund === null ? null : { refundRef: row.refund.id, state: row.refund.state,
      amountKopecks: Number(row.refund.amountKopecks), observedStatus: row.refund.observedStatus,
      errorCode: row.refund.errorCode, updatedAt: row.refund.updatedAt.toISOString() },
  }));
}

export async function listPayments(prisma: BillingPrismaClient, command: Extract<OwnerOperation, { operation: "payments.list" }>): Promise<OwnerResult> {
  // Cursor — идентификатор последнего показанного платежа: его позиция читается на сервере.
  const after = command.cursor === undefined ? null
    : await prisma.billingPurchase.findUnique({ where: { id: command.cursor }, select: { id: true, createdAt: true } });
  // Неизвестный идентификатор не выдаётся за начало списка.
  if (command.cursor !== undefined && after === null) return ownerFailure("invalid_request");
  const rows = await prisma.billingPurchase.findMany({
    where: {
      ...(command.accountId === undefined ? {} : { accountId: command.accountId }),
      ...(command.state === undefined ? {} : { state: command.state }),
      ...(command.kind === undefined ? {} : { kind: command.kind }),
      ...(after === null ? {} : { OR: [{ createdAt: { lt: after.createdAt } }, { createdAt: after.createdAt, id: { lt: after.id } }] }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: command.limit + 1,
  });
  const page = rows.slice(0, command.limit);
  return { ok: true, operationRef: command.operationId, result: {
    outcome: "payments", items: await paymentViews(prisma, page),
    nextCursor: rows.length > command.limit ? page.at(-1)?.id ?? null : null,
  } };
}

export async function readPayment(prisma: BillingPrismaClient, purchaseRef: string): Promise<
  Extract<OwnerResult, { ok: false }> | { readonly ok: true; readonly result: Extract<OwnerOutcome, { outcome: "payment" }> }> {
  const row = await prisma.billingPurchase.findUnique({ where: { id: purchaseRef } });
  if (row === null) return ownerFailure("not_found");
  const [value, events, decisions, audit] = await Promise.all([
    paymentView(prisma, row),
    prisma.billingPaymentEvent.findMany({ where: { purchaseRef }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] }),
    refundDecisionViews(prisma, purchaseRef),
    // Аудит читается в порядке записи: одинаковый момент двух команд не меняет их последовательность.
    prisma.billingOwnerCommand.findMany({ where: { targetRef: purchaseRef }, orderBy: { sequence: "asc" }, take: 100 }),
  ]);
  return { ok: true, result: {
    outcome: "payment", value,
    // Событие фиксирует факт и время; денежные подробности читаются из самого платежа.
    events: events.map(event => paymentEventViewSchema.parse({ kind: event.kind,
      occurredAt: event.occurredAt.toISOString(), recordedAt: event.recordedAt.toISOString() })),
    decisions,
    audit: audit.map(entry => auditEntryViewSchema.parse({ actorId: entry.actorId, operationId: entry.operationId,
      operation: entry.operation, reason: entry.reason, createdAt: entry.createdAt.toISOString() })),
  } };
}
