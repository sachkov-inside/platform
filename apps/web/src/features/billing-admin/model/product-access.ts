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
export const listProductAccessSchema = z.strictObject({
  accountId: z.uuid().optional(),
  productId: z.uuid().optional(),
  limit: z.int().min(1).max(100),
  cursor: z.string().optional(),
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
export const productAccessDetailSchema = productAccessSchema.extend({
  sources: z.array(
    z.object({
      source: z.string(),
      sourceRef: z.string(),
      issuedAt: z.iso.datetime(),
      reason: z.string(),
    }),
  ),
  actions: z.array(
    z.object({
      id: z.uuid(),
      kind: z.string(),
      actorId: z.string().nullable(),
      reason: z.string(),
      recordedAt: z.iso.datetime(),
      revision: z.int().positive(),
    }),
  ),
});
