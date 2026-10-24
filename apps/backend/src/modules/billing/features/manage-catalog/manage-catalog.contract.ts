import { z } from "zod";
import {
  idSchema,
  promotionSchema,
  revisionSchema,
} from "../../domain/pricing.js";
import { productSalesValueSchema } from "../../domain/product-sales-state.js";

const envelope = {
  operationId: idSchema,
  expectedRevision: revisionSchema.optional(),
};
const archive = {
  operationId: idSchema,
  expectedRevision: revisionSchema,
  id: idSchema,
};
export const productPriceSchema = z.strictObject({
  productId: idSchema,
  name: z.string().trim().min(1).max(200),
  priceKopecks: z.int().positive(),
  published: z.boolean(),
});
export const manageCatalogSchema = z.discriminatedUnion("operation", [
  z.strictObject({
    ...envelope,
    operation: z.literal("productPrices.save"),
    value: productPriceSchema,
  }),
  z.strictObject({ ...archive, operation: z.literal("productPrices.archive") }),
  z.strictObject({
    ...envelope,
    operation: z.literal("promotions.save"),
    value: promotionSchema.omit({ revision: true, archived: true }),
  }),
  z.strictObject({ ...archive, operation: z.literal("promotions.archive") }),
  z.strictObject({
    ...envelope,
    operation: z.literal("cohorts.save"),
    value: productSalesValueSchema,
  }),
  z.strictObject({
    ...envelope,
    operation: z.literal("productSalesState.save"),
    value: productSalesValueSchema,
  }),
]);
export type ManageCatalogCommand = z.infer<typeof manageCatalogSchema>;
export const catalogOutcomeSchema = z.strictObject({
  id: idSchema,
  revision: revisionSchema,
  archived: z.boolean(),
  published: z.boolean().optional(),
});
