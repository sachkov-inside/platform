import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  lockBillingPricing,
  lockBillingPurchase,
  type BillingPrisma,
  type BillingPrismaClient,
  Prisma,
} from "../../../../infrastructure/prisma/index.js";

/** Событие покупки этого вида пишется один раз. Вызывающий держит замок покупки. */
export async function recordEventOnce(
  tx: BillingPrisma,
  purchaseRef: string,
  kind: string,
  payload: Prisma.InputJsonObject,
  now: Date,
): Promise<void> {
  if (await hasEvent(tx, purchaseRef, kind)) return;
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

/** У покупки уже есть событие этого вида. */
export async function hasEvent(
  tx: BillingPrisma,
  purchaseRef: string,
  kind: string,
): Promise<boolean> {
  const known = await tx.billingPaymentEvent.findUnique({
    where: { purchaseRef_kind: { purchaseRef, kind } },
    select: { id: true },
  });
  return known !== null;
}

/**
 * Inside закрывает попытку без оплаты: покупка и её резерв переходят в `failed`, адрес формы
 * стирается, а освобождённая ссылка на оплату подтверждает резерв ждущей оплаченной покупки.
 * Событие `event` пишется один раз. Так закрывают попытку снятие до Init, отказ банка, снятие
 * после Init, частичная отмена без подтверждённой оплаты и отсутствие платежа в банке.
 * Вызывающий держит замок цен.
 */
export async function closeAttempt(
  tx: BillingPrisma,
  attemptRef: string,
  now: Date,
  options: {
    readonly event?: {
      readonly kind: string;
      readonly payload: Prisma.InputJsonObject;
    };
    /** PaymentId из ответа банка, который закрыл попытку. */
    readonly paymentId?: string;
    /** Ссылку не трогать: подтверждение после отказа само решает о резерве ссылки. */
    readonly keepLink?: boolean;
  } = {},
): Promise<void> {
  await tx.billingPurchase.update({
    where: { id: attemptRef },
    data: {
      state: "failed",
      lifecycleActive: false,
      paymentUrl: null,
      updatedAt: now,
      ...(options.paymentId === undefined
        ? {}
        : { paymentId: options.paymentId }),
    },
  });
  await tx.billingPromoReservation.updateMany({
    where: { purchaseRef: attemptRef },
    data: { state: "failed" },
  });
  if (options.keepLink !== true) await releaseRetiredLink(tx, attemptRef);
  if (options.event !== undefined)
    await recordEventOnce(
      tx,
      attemptRef,
      options.event.kind,
      options.event.payload,
      now,
    );
}

/** Закрытая попытка отпустила ссылку на оплату: ждущий резерв оплаченной покупки подтверждается. */
export async function releaseRetiredLink(
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

/**
 * Подтверждённая после отказа покупка оставила резерв неуспешным, пока ссылку держала другая
 * попытка. Когда держатель отпал, резерв подтверждается: иначе оплаченная ссылка выглядит
 * свободной и её можно оплатить ещё раз. Выборка видит только такие резервы и не больше `limit`.
 */
export async function confirmReleasedLinkReservations(
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
      await releaseRetiredLink(tx, purchaseRef);
    });
  }
}
