import {
  PAYMENT_AUDIT_PAGE_SIZE,
  paymentAuditCursorSchema,
} from "@inside/contracts/payment-audit";
import type { z } from "zod";
import type {
  BillingPrisma,
  BillingPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";
import {
  auditEntryViewSchema,
  paymentEventViewSchema,
  paymentViewSchema,
  refundDecisionViewSchema,
  ownerFailure,
  type OwnerOperation,
  type OwnerOutcome,
  type OwnerResult,
} from "../../domain/owner-operations.js";
import { refundTotalsOf } from "../../shared/refund-amounts.js";

type PurchaseRow = Awaited<
  ReturnType<BillingPrisma["billingPurchase"]["findUniqueOrThrow"]>
>;
type PaymentView = z.infer<typeof paymentViewSchema>;

/**
 * Владельческие виды платежей: банковское состояние, оплаченные условия, готовность доступа и
 * остаток к возврату. Незавершённая выдача и попытки возврата читаются одним запросом на страницу,
 * а не на строку. Сохранённые привязка, контакт и raw payload банка сюда не попадают.
 */
export async function paymentViews(
  tx: BillingPrisma,
  rows: readonly PurchaseRow[],
): Promise<PaymentView[]> {
  if (rows.length === 0) return [];
  const purchaseRefs = rows.map((row) => row.id);
  const [pending, refunds] = await Promise.all([
    tx.billingFulfillment.findMany({
      where: { purchaseRef: { in: purchaseRefs }, appliedAt: null },
      select: { purchaseRef: true, reviewRequiredAt: true },
    }),
    tx.billingRefund.findMany({
      where: { purchaseRef: { in: purchaseRefs } },
      select: { purchaseRef: true, state: true, amountKopecks: true },
    }),
  ]);
  return rows.map((row) => {
    const totals = refundTotalsOf(
      refunds.filter((refund) => refund.purchaseRef === row.id),
      row.amountKopecks,
    );
    const waiting = pending.some((item) => item.purchaseRef === row.id);
    return paymentViewSchema.parse({
      purchaseRef: row.id,
      accountId: row.accountId,
      kind: row.kind,
      state: row.state,
      subscriptionRef: row.subscriptionRef,
      periodIndex: row.periodIndex,
      amountKopecks: Number(row.amountKopecks),
      environment: row.environment,
      terminalRef: row.terminalRef,
      paymentId: row.paymentId,
      snapshot: row.snapshot,
      fiscalization: row.fiscalization,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      periodEndsAt: row.periodEndsAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      access:
        row.state !== "confirmed"
          ? "awaiting_payment"
          : pending.some(
                (item) =>
                  item.purchaseRef === row.id && item.reviewRequiredAt !== null,
              )
            ? "review_required"
            : waiting
              ? "preparing"
              : "ready",
      refundedKopecks: row.refundReviewRequired ? null : totals.refundedKopecks,
      refundableKopecks: row.refundReviewRequired
        ? null
        : totals.refundableKopecks,
    });
  });
}

export async function paymentView(
  tx: BillingPrisma,
  row: PurchaseRow,
): Promise<PaymentView> {
  const [view] = await paymentViews(tx, [row]);
  if (view === undefined) throw new Error("Payment view is missing");
  return view;
}

export async function refundDecisionViews(
  tx: BillingPrisma,
  purchaseRef: string,
): Promise<z.infer<typeof refundDecisionViewSchema>[]> {
  const rows = await tx.billingRefundDecision.findMany({
    where: { purchaseRef },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { refund: true },
  });
  return rows.map((row) =>
    refundDecisionViewSchema.parse({
      decisionRef: row.id,
      purchaseRef: row.purchaseRef,
      accountId: row.accountId,
      actorId: row.actorId,
      amountKopecks: Number(row.amountKopecks),
      basis: row.basis,
      access: row.access,
      recurring: row.recurring,
      reason: row.reason,
      state: row.state,
      revision: row.revision,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      attempt:
        row.refund === null
          ? null
          : {
              refundRef: row.refund.id,
              state: row.refund.state,
              amountKopecks: Number(row.refund.amountKopecks),
              observedStatus: row.refund.observedStatus,
              errorCode: row.refund.errorCode,
              updatedAt: row.refund.updatedAt.toISOString(),
            },
    }),
  );
}

type ListPaymentsCommand = Extract<
  OwnerOperation,
  { operation: "payments.list" }
>;

/**
 * Неизменяемая часть фильтра: покупатель, вид, продукт оплаченного снимка и период создания.
 * Cursor обязан лежать внутри неё. Состояние меняется со временем, поэтому позиция платежа,
 * сменившего состояние, остаётся допустимым продолжением.
 */
function scopeOf(
  command: ListPaymentsCommand,
): Prisma.BillingPurchaseWhereInput {
  return {
    ...(command.accountId === undefined
      ? {}
      : { accountId: command.accountId }),
    ...(command.kind === undefined ? {} : { kind: command.kind }),
    ...(command.productId === undefined
      ? {}
      : { snapshot: { path: ["product", "id"], equals: command.productId } }),
    ...(command.from === undefined && command.to === undefined
      ? {}
      : {
          createdAt: {
            ...(command.from === undefined
              ? {}
              : { gte: new Date(command.from) }),
            ...(command.to === undefined ? {} : { lt: new Date(command.to) }),
          },
        }),
  };
}

function statesOf(command: ListPaymentsCommand): readonly string[] | null {
  if (command.states !== undefined) return command.states;
  return command.state === undefined ? null : [command.state];
}

export async function listPayments(
  prisma: BillingPrismaClient,
  command: ListPaymentsCommand,
): Promise<OwnerResult> {
  if (command.state !== undefined && command.states !== undefined)
    return ownerFailure("invalid_request");
  if (
    command.states !== undefined &&
    new Set(command.states).size !== command.states.length
  )
    return ownerFailure("invalid_request");
  if (
    command.from !== undefined &&
    command.to !== undefined &&
    Date.parse(command.from) >= Date.parse(command.to)
  )
    return ownerFailure("invalid_request");
  const scope = scopeOf(command);
  // Cursor — идентификатор последнего показанного платежа: его позиция читается на сервере.
  const after =
    command.cursor === undefined
      ? null
      : await prisma.billingPurchase.findFirst({
          where: { AND: [{ id: command.cursor }, scope] },
          select: { id: true, createdAt: true },
        });
  // Неизвестный идентификатор и платёж вне фильтра не выдаются за начало списка.
  if (command.cursor !== undefined && after === null)
    return ownerFailure("invalid_request");
  const states = statesOf(command);
  const rows = await prisma.billingPurchase.findMany({
    where: {
      AND: [
        scope,
        states === null ? {} : { state: { in: [...states] } },
        after === null
          ? {}
          : {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: command.limit + 1,
  });
  const page = rows.slice(0, command.limit);
  return {
    ok: true,
    operationRef: command.operationId,
    result: {
      outcome: "payments",
      items: await paymentViews(prisma, page),
      nextCursor:
        rows.length > command.limit ? (page.at(-1)?.id ?? null) : null,
    },
  };
}

export async function readPayment(
  prisma: BillingPrismaClient,
  purchaseRef: string,
  auditCursor?: z.infer<typeof paymentAuditCursorSchema>,
): Promise<
  | Extract<OwnerResult, { ok: false }>
  | {
      readonly ok: true;
      readonly result: Extract<OwnerOutcome, { outcome: "payment" }>;
    }
> {
  const cursor =
    auditCursor === undefined
      ? undefined
      : paymentAuditCursorSchema.safeParse(auditCursor);
  if (
    cursor !== undefined &&
    (!cursor.success ||
      cursor.data.purchaseRef !== purchaseRef.toLowerCase() ||
      BigInt(cursor.data.afterSequence) > 9223372036854775807n)
  )
    return ownerFailure("invalid_request");
  const afterSequence = cursor?.success
    ? BigInt(cursor.data.afterSequence)
    : undefined;
  const row = await prisma.billingPurchase.findUnique({
    where: { id: purchaseRef },
  });
  if (row === null) return ownerFailure("not_found");
  const [value, events, decisions, audit] = await Promise.all([
    paymentView(prisma, row),
    prisma.billingPaymentEvent.findMany({
      where: { purchaseRef },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    }),
    refundDecisionViews(prisma, purchaseRef),
    // Аудит читается в порядке записи: одинаковый момент двух команд не меняет их последовательность.
    prisma.billingOwnerCommand.findMany({
      where: {
        targetRef: purchaseRef,
        ...(afterSequence === undefined
          ? {}
          : { sequence: { gt: afterSequence } }),
      },
      orderBy: { sequence: "asc" },
      take: PAYMENT_AUDIT_PAGE_SIZE + 1,
    }),
  ]);
  return {
    ok: true,
    result: {
      outcome: "payment",
      value,
      // Событие фиксирует факт и время; денежные подробности читаются из самого платежа.
      events: events.map((event) =>
        paymentEventViewSchema.parse({
          kind: event.kind,
          occurredAt: event.occurredAt.toISOString(),
          recordedAt: event.recordedAt.toISOString(),
        }),
      ),
      decisions,
      nextAuditCursor:
        audit.length > PAYMENT_AUDIT_PAGE_SIZE
          ? {
              purchaseRef: row.id,
              afterSequence: String(
                audit[PAYMENT_AUDIT_PAGE_SIZE - 1]?.sequence,
              ),
            }
          : null,
      audit: audit.slice(0, PAYMENT_AUDIT_PAGE_SIZE).map((entry) =>
        auditEntryViewSchema.parse({
          actorId: entry.actorId,
          operationId: entry.operationId,
          operation: entry.operation,
          reason: entry.reason,
          createdAt: entry.createdAt.toISOString(),
        }),
      ),
    },
  };
}
