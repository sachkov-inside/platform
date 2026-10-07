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
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";

/** Offer и режим приглашения по коду, чтобы billing прочитал каталог до погашения. */
export async function readInvitationTarget(
  prisma: AccountRightsPrismaClient,
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
}

/**
 * Погашает приглашение для приватно проверенной Telegram identity. Первое открытие закрепляет
 * приглашение за identity; другая identity получает `claimed_by_other`. Без Account закрепление
 * сохраняется и ждёт привязки. Приглашение допускает Account к покупке Offer. Повтор той же пары
 * `(code, identityRef)` возвращает тот же итог.
 */
export async function redeemInvitation(
  prisma: AccountRightsPrismaClient,
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
    if (state === "redeemed")
      return outcome({
        state: "already_redeemed",
        mode: "purchase",
        offerId: row.offerId,
      });
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
  });
}
