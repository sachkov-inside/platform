import { z } from "zod";
import type { BillingPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { failure, idSchema, type PricingResult } from "../../domain/pricing.js";
import { lockPricing } from "../../infrastructure/postgres/catalog-lock.js";

export const reservationStateSchema = z.enum(["reserved", "sent", "unknown", "confirmed", "failed"]);
export type ReservationState = z.infer<typeof reservationStateSchema>;
const transitionSchema = z.strictObject({ purchaseRef: idSchema, accountId: idSchema, state: reservationStateSchema.exclude(["reserved"]) });
export type SettleReservation = z.infer<typeof transitionSchema>;
const transitions: Record<ReservationState, readonly ReservationState[]> = {
  reserved: ["sent", "failed"], sent: ["unknown", "confirmed", "failed"], unknown: ["confirmed", "failed"], confirmed: [], failed: [],
};

// Only verified bank outcomes or a proven pre-send cancellation may release capacity.
// A timer/browser return is never input to this internal operation.
export async function settleReservation(prisma: BillingPrismaClient, input: SettleReservation): Promise<PricingResult<{ state: ReservationState }>> {
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_request");
  try {
    return await prisma.$transaction(async (tx): Promise<PricingResult<{ state: ReservationState }>> => {
      await lockPricing(tx);
      const command = parsed.data;
      const row = await tx.billingPromoReservation.findUnique({ where: { purchaseRef: command.purchaseRef } });
      if (!row || row.accountId !== command.accountId) return failure("not_found");
      const current = reservationStateSchema.parse(row.state);
      if (current === command.state) return { ok: true, value: { state: current } };
      if (!transitions[current].includes(command.state)) return failure("reservation_conflict");
      await tx.billingPromoReservation.update({ where: { purchaseRef: command.purchaseRef }, data: { state: command.state } });
      return { ok: true, value: { state: command.state } };
    });
  } catch { return failure("dependency_unavailable"); }
}
