import { coverageEntrySchema } from "@inside/access-capabilities";
import { z } from "zod";
import {
  idSchema,
  priceSnapshotSchema,
  revisionSchema,
} from "../../domain/pricing.js";

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
export const paymentLinkCommandSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    operation: z.literal("paymentLinks.create"),
    operationId: idSchema,
    paymentOptionId: idSchema,
    optionRevision: revisionSchema,
    price: paymentLinkPriceSchema,
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  }),
  z.strictObject({
    operation: z.literal("paymentLinks.revoke"),
    operationId: idSchema,
    id: idSchema,
    expectedRevision: revisionSchema,
  }),
]);
export const paymentLinkViewSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  state: z.enum([
    "active",
    "pending",
    "unknown",
    "paid",
    "revoked",
    "expired",
    "changed",
  ]),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().nullable(),
  snapshot: priceSnapshotSchema,
});
export type PaymentLinkView = z.infer<typeof paymentLinkViewSchema>;
export const paymentLinksListSchema = z.strictObject({
  cursor: idSchema.optional(),
  limit: z.int().min(1).max(100).default(50),
});
export const paymentLinksPageSchema = z.strictObject({
  items: z.array(paymentLinkViewSchema),
  nextCursor: idSchema.nullable(),
});

export const paymentLinkDetailSchema = paymentLinkViewSchema.extend({
  product: coverageEntrySchema.nullable(),
});
