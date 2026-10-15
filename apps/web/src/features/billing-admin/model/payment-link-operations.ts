import { z } from "zod";
import {
  paymentLinkSchema,
  paymentLinksPageSchema,
} from "@/entities/subscription";
export const createPaymentLinkInputSchema = z.strictObject({
  operationId: z.uuid(),
  paymentOptionId: z.uuid(),
  optionRevision: z.int().positive(),
  price: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("amount"),
      amountKopecks: z.int().min(100).max(100_000_000),
    }),
    z.strictObject({
      kind: z.literal("discount"),
      percent: z.int().min(0).max(99),
    }),
  ]),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});
export const revokePaymentLinkInputSchema = z.strictObject({
  operationId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.int().positive(),
});
export const listPaymentLinksInputSchema = z.strictObject({
  operationId: z.uuid(),
  cursor: z.uuid().optional(),
  limit: z.int().min(1).max(100),
});
export const paymentLinkOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("paymentLink"),
    value: paymentLinkSchema,
  }),
});
export const paymentLinksOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: paymentLinksPageSchema.extend({ outcome: z.literal("paymentLinks") }),
});
export type CreatePaymentLinkInput = z.infer<
  typeof createPaymentLinkInputSchema
>;
export type RevokePaymentLinkInput = z.infer<
  typeof revokePaymentLinkInputSchema
>;
export type ListPaymentLinksInput = z.infer<typeof listPaymentLinksInputSchema>;
