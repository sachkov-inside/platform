import { z } from "zod";
import { accessCapabilitySchema } from "@/entities/subscription";
export const productRevocationTargetSchema = z.strictObject({
  accountId: z.uuid(),
  productId: z.uuid(),
});
export const productRevocationCommandSchema =
  productRevocationTargetSchema.extend({
    operationId: z.uuid(),
    expectedRevision: z.number().int().nonnegative(),
    reason: z.string().trim().min(1).max(1000),
  });
export const productRevocationPreviewSchema =
  productRevocationTargetSchema.extend({
    revision: z.number().int().nonnegative(),
    affectedCount: z.number().int().nonnegative(),
    affected: z.array(
      z.strictObject({
        source: z.enum(["paid", "manual", "legacy"]),
        capabilities: z.array(accessCapabilitySchema),
        validUntil: z.iso.datetime().nullable(),
      }),
    ),
  });
export const productRevocationPreviewResponseSchema = z.strictObject({
  ok: z.literal(true),
  value: productRevocationPreviewSchema,
});
export const productRevocationResponseSchema = z.strictObject({
  ok: z.literal(true),
  value: productRevocationTargetSchema.extend({
    revision: z.number().int().positive(),
    access: z.literal("revoked"),
  }),
});
