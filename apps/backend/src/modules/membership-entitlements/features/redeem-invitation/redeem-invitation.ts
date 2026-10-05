import { z } from "zod";
import { lockAccountAccess } from "../../../../infrastructure/prisma/index.js";
import { accessFailure } from "../../domain/access-grant.js";
import {
  invitationCodeSchema,
  invitationState,
  redeemInvitationSchema,
  type InvitationOffer,
  type InvitationRedemption,
} from "../../domain/invitation.js";
import type { MembershipEntitlementsPrismaClient } from "../../infrastructure/prisma.js";
import { enrollmentView } from "../../shared/enrollment-view.js";
import { assignEnrollmentInTransaction } from "../assign-enrollment/assign-enrollment.js";

/** Offer и режим приглашения по коду, чтобы billing прочитал каталог до погашения. */
export async function readInvitationTarget(
  prisma: MembershipEntitlementsPrismaClient,
  code: string,
) {
  if (!invitationCodeSchema.safeParse(code).success) return null;
  return prisma.invitation.findUnique({
    where: { code },
    select: { offerId: true, mode: true },
  });
}

export interface RedeemInvitationContext {
  /** Account, к которому сейчас привязана identity; `null` — Account ещё нет. */
  readonly accountId: string | null;
  /** Offer приглашения в каталоге; `null` — Offer больше нет. */
  readonly offer: InvitationOffer | null;
  /** Конец подарочного срока в календарных месяцах от момента погашения. */
  readonly periodEnd: (anchor: Date, months: number) => Date;
}

/**
 * Погашает приглашение для приватно проверенной Telegram identity. Первое открытие закрепляет
 * приглашение за identity; другая identity получает `claimed_by_other`. Без Account закрепление
 * сохраняется и ждёт привязки. Оплата допускает Account к покупке Offer; подарок назначает
 * SubscriptionEnrollment origin `invitation` в той же транзакции. Повтор той же пары
 * `(code, identityRef)` возвращает тот же итог.
 */
export async function redeemInvitation(
  prisma: MembershipEntitlementsPrismaClient,
  input: unknown,
  context: RedeemInvitationContext,
  now: Date,
) {
  const parsed = redeemInvitationSchema.safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  if (
    context.accountId !== null &&
    !z.uuid().safeParse(context.accountId).success
  )
    return accessFailure("invalid_input");
  const { code, identityRef } = parsed.data;
  const outcome = (value: InvitationRedemption) => ({
    ok: true as const,
    value,
  });
  return prisma.$transaction(async (tx) => {
    await lockAccountAccess(tx, `invitation-code:${code}`);
    const row = await tx.invitation.findUnique({ where: { code } });
    if (row === null) return outcome({ state: "unavailable" });
    if (
      row.claimedIdentityRef !== null &&
      row.claimedIdentityRef !== identityRef
    )
      return outcome({ state: "claimed_by_other" });
    const state = invitationState(row, now);
    if (state === "revoked") return outcome({ state: "revoked" });
    if (state === "redeemed") {
      if (row.mode === "purchase")
        return outcome({
          state: "already_redeemed",
          mode: "purchase",
          offerId: row.offerId,
        });
      const enrollment =
        row.enrollmentId === null
          ? null
          : await tx.subscriptionEnrollment.findUnique({
              where: { id: row.enrollmentId },
            });
      if (enrollment === null)
        throw new Error("Redeemed gift invitation lost its Enrollment");
      return outcome({
        state: "already_redeemed",
        mode: "gift",
        offerId: row.offerId,
        enrollment: enrollmentView(enrollment, now),
      });
    }
    if (state === "expired") return outcome({ state: "expired" });
    let revision = row.revision;
    if (row.claimedAt === null) {
      revision += 1;
      await tx.invitation.update({
        where: { id: row.id },
        data: { claimedAt: now, claimedIdentityRef: identityRef, revision },
      });
    }
    if (context.accountId === null) return outcome({ state: "needs_account" });
    const offer = context.offer;
    if (offer === null || offer.id !== row.offerId)
      return outcome({ state: "unavailable" });
    if (row.mode === "purchase") {
      if (!offer.purchasable) return outcome({ state: "unavailable" });
      await tx.invitation.update({
        where: { id: row.id },
        data: {
          claimedAccountId: context.accountId,
          redeemedAt: now,
          revision: revision + 1,
        },
      });
      return outcome({
        state: "purchase_ready",
        mode: "purchase",
        offerId: row.offerId,
      });
    }
    if (offer.tier === null) return outcome({ state: "unavailable" });
    const assigned = await assignEnrollmentInTransaction(
      tx,
      null,
      {
        operationId: row.id,
        accountId: context.accountId,
        origin: "invitation",
        sourceRef: row.id,
        tierId: offer.tier.id,
        tierRevision: offer.tier.revision,
        terms: {
          startsAt: now.toISOString(),
          endsAt:
            row.giftMonths === null
              ? null
              : context.periodEnd(now, row.giftMonths).toISOString(),
          endPolicy: "fixed",
        },
        billingRef: null,
        reason: "Подарок по приглашению",
      },
      offer.tier,
      now,
    );
    if (!assigned.ok) return assigned;
    await tx.invitation.update({
      where: { id: row.id },
      data: {
        claimedAccountId: context.accountId,
        redeemedAt: now,
        enrollmentId: assigned.value.id,
        revision: revision + 1,
      },
    });
    return outcome({
      state: "gift_granted",
      mode: "gift",
      offerId: row.offerId,
      enrollment: assigned.value,
    });
  });
}
