import {
  lockBillingPricing,
  lockBillingSubscription,
  type BillingPrisma,
  type BillingPrismaClient,
} from "../../../infrastructure/prisma/index.js";
import { hasText } from "../../../infrastructure/contracts/text.js";
import {
  subscriptionSaleConfirmed,
  type SubscriptionTerminal,
} from "../domain/sale-capability.js";
import { endSubscription, inFlightStates } from "./subscription-outcome.js";

type SubscriptionWhere = NonNullable<
  Parameters<BillingPrisma["billingSubscription"]["findMany"]>[0]
>["where"];

interface Binding {
  readonly bindingRef: string | null;
  readonly bindingCiphertext: string | null;
  readonly bindingRevokedAt: Date | null;
}

/** Пригодность сохранённого способа не зависит от временной конфигурации процесса. */
export function usableRenewalBinding(
  binding: Binding,
): binding is Binding & { bindingRef: string; bindingCiphertext: string } {
  return (
    hasText(binding.bindingRef) &&
    hasText(binding.bindingCiphertext) &&
    binding.bindingRevokedAt === null
  );
}

/** Принятое расписание: активная подписка с пригодным сохранённым способом. */
export function renewalScheduled(
  subscription: Binding & { readonly state: string },
): subscription is Binding & {
  state: "active";
  bindingRef: string;
  bindingCiphertext: string;
} {
  return subscription.state === "active" && usableRenewalBinding(subscription);
}

export type RenewalTerminal = "no_terminal" | "no_recurring" | "ready";
export function renewalTerminal(
  terminal: SubscriptionTerminal | undefined,
): RenewalTerminal {
  if (terminal === undefined) return "no_terminal";
  return subscriptionSaleConfirmed(terminal) ? "ready" : "no_recurring";
}

/** Выборка того же расписания для списания, календаря и владельческого обзора. */
export const scheduledRenewalsWhere: SubscriptionWhere = {
  state: "active",
  bindingRef: { not: null },
  bindingCiphertext: { not: null, notIn: [""] },
  bindingRevokedAt: null,
};

/** Явные ветки для nullable полей: SQL NOT не включает NULL как отсутствующий способ. */
export const unscheduledSubscriptionsWhere: SubscriptionWhere = {
  OR: [
    { state: "canceled" },
    { bindingRef: null },
    { bindingCiphertext: null },
    { bindingCiphertext: "" },
    { bindingRevokedAt: { not: null } },
  ],
};

export async function dueRenewals(
  prisma: BillingPrismaClient,
  now: Date,
  limit: number,
) {
  return prisma.billingSubscription.findMany({
    where: {
      ...scheduledRenewalsWhere,
      paidUntil: { lte: now },
      attempts: { none: { state: { in: inFlightStates } } },
    },
    orderBy: [{ paidUntil: "asc" }, { id: "asc" }],
    take: limit,
  });
}

/** Непродлеваемые сроки не ждут за активными расписаниями и неизвестными оплатами. */
export async function closeLapsedSubscriptions(
  prisma: BillingPrismaClient,
  now: Date,
  limit: number,
): Promise<number> {
  const candidates = await prisma.billingSubscription.findMany({
    where: {
      state: { not: "ended" },
      paidUntil: { lte: now },
      ...unscheduledSubscriptionsWhere,
      attempts: { none: { state: { in: inFlightStates } } },
    },
    orderBy: [{ paidUntil: "asc" }, { id: "asc" }],
    take: limit,
  });
  let closed = 0;
  for (const subscription of candidates)
    closed += await prisma.$transaction(async (tx) => {
      await lockBillingPricing(tx);
      await endLapsedSubscriptions(tx, subscription.accountId, now);
      return (
        await tx.billingSubscription.findUniqueOrThrow({
          where: { id: subscription.id },
        })
      ).state === "ended"
        ? 1
        : 0;
    });
  return closed;
}

/**
 * Освобождает Account для новой покупки, когда оплаченный срок закончился и продлить его
 * нечем. Незавершённая попытка оплаты сохраняет подписку до сверки.
 */
export async function endLapsedSubscriptions(
  tx: BillingPrisma,
  accountId: string,
  now: Date,
): Promise<void> {
  // Покупка, подтверждённая до появления подписок, освобождает место по своему сохранённому концу.
  await tx.billingPurchase.updateMany({
    where: {
      accountId,
      kind: "initial",
      state: "confirmed",
      lifecycleActive: true,
      subscriptionRef: null,
      periodEndsAt: { lte: now },
    },
    data: { lifecycleActive: false },
  });
  const candidates = await tx.billingSubscription.findMany({
    where: { accountId, state: { not: "ended" }, paidUntil: { lte: now } },
  });
  for (const candidate of candidates) {
    await lockBillingSubscription(tx, candidate.id);
    const row = await tx.billingSubscription.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    if (row.state === "ended" || row.paidUntil > now) continue;
    if (
      (await tx.billingPurchase.count({
        where: { subscriptionRef: row.id, state: { in: inFlightStates } },
      })) > 0
    )
      continue;
    if (renewalScheduled(row)) continue;
    await endSubscription(
      tx,
      row.id,
      row.state === "canceled"
        ? "canceled_period_ended"
        : "no_usable_payment_method",
      now,
    );
  }
}
