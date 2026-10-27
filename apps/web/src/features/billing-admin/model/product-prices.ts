import { z } from "zod";
export const saveProductPriceSchema = z.strictObject({
  operationId: z.uuid(),
  expectedRevision: z.int().positive().optional(),
  value: z.strictObject({
    productId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    priceKopecks: z.int().min(100).max(100_000_000),
    published: z.boolean(),
  }),
});
export const archiveProductPriceSchema = z.strictObject({
  operationId: z.uuid(),
  id: z.uuid(),
  expectedRevision: z.int().positive(),
});
