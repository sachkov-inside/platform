import { z } from "zod";

import {
  paymentLinkSchema,
  paymentLinksPageSchema,
} from "@/entities/subscription";

/** Видимое состояние ссылки, которое выводит сервер; по нему же фильтруется список. */
export const paymentLinkStateSchema = paymentLinkSchema.shape.state;
export type PaymentLinkState = z.infer<typeof paymentLinkStateSchema>;

export const paymentLinkPriceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("amount"),
    amountKopecks: z.int().min(100).max(100_000_000),
  }),
  z.strictObject({
    kind: z.literal("discount"),
    percent: z.int().min(0).max(99),
  }),
]);
export type PaymentLinkPrice = z.infer<typeof paymentLinkPriceSchema>;

export const createPaymentLinkInputSchema = z.strictObject({
  operationId: z.uuid(),
  productId: z.uuid(),
  priceRevision: z.int().positive(),
  price: paymentLinkPriceSchema,
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
});
export const revokePaymentLinkInputSchema = z.strictObject({
  operationId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.int().positive(),
});
/** Страница списка от новых к старым; курсор действует только в своём фильтре. */
export const listPaymentLinksInputSchema = z.strictObject({
  operationId: z.uuid(),
  productId: z.uuid().optional(),
  state: paymentLinkStateSchema.optional(),
  cursor: z.string().min(1).max(1024).optional(),
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
