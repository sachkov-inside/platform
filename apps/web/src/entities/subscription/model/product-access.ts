import { z } from "zod";
export const productAccessSchema = z.object({
  accountId: z.uuid(),
  productId: z.uuid(),
  access: z.enum(["active", "revoked"]),
  firstIssuedAt: z.iso.datetime().nullable(),
  revision: z.int().positive(),
});
export const accessPairSchema = z.strictObject({
  accountId: z.uuid(),
  productId: z.uuid(),
});
export const issueProductAccessSchema = accessPairSchema.extend({
  sourceRef: z.string().trim().min(1).max(256),
  reason: z.string().trim().min(1).max(1000),
});
export const changeProductAccessSchema = accessPairSchema.extend({
  operationId: z.uuid(),
  expectedRevision: z.int().positive(),
  reason: z.string().trim().min(1).max(1000),
});
