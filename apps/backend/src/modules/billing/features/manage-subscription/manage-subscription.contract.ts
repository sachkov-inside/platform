import { coverageEntrySchema } from "@inside/access-capabilities";
import { z } from "zod";
import {
  attemptKindSchema,
  attemptStateSchema,
} from "../../domain/payment-attempt.js";
import {
  idSchema,
  moneySchema,
  priceSnapshotSchema,
} from "../../domain/pricing.js";
import { purchaseStatusSchema } from "../purchase-product/purchase-product.contract.js";

export const ownPaymentSchema = z.strictObject({
  purchaseRef: idSchema,
  content: z.array(coverageEntrySchema).optional(),
  productAccess: z
    .array(
      z.strictObject({
        productId: idSchema,
        access: purchaseStatusSchema.shape.access,
      }),
    )
    .optional(),
  snapshot: priceSnapshotSchema.optional(),
  access: purchaseStatusSchema.shape.access.optional(),
  kind: attemptKindSchema,
  state: attemptStateSchema,
  amountKopecks: moneySchema,
  offerName: z.string().min(1).max(200),
  months: z.int().positive().max(1200),
  fiscalization: z.enum(["not_configured", "pending", "confirmed", "failed"]),
  confirmedAt: z.iso.datetime().nullable(),
  periodEndsAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** Возвращено банком по этому платежу; неподтверждённые попытки не считаются. */
  refundedKopecks: z.int().nonnegative().nullable(),
  refundedAt: z.iso.datetime().nullable(),
});
export type OwnPayment = z.infer<typeof ownPaymentSchema>;
