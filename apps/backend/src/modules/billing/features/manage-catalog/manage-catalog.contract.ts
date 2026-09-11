import { z } from "zod";
import { idSchema, revisionSchema, offerSchema, optionSchema, promotionSchema } from "../../domain/pricing.js";

const envelope = { operationId: idSchema, expectedRevision: revisionSchema.optional() };
const archive = { operationId: idSchema, expectedRevision: revisionSchema, id: idSchema };
export const manageCatalogSchema = z.discriminatedUnion("operation", [
  z.strictObject({ ...envelope, operation: z.literal("offers.save"), value: offerSchema.omit({ revision: true, archived: true, published: true }) }),
  z.strictObject({ ...archive, operation: z.literal("offers.archive") }),
  z.strictObject({ ...archive, operation: z.literal("offers.publish") }),
  z.strictObject({ ...archive, operation: z.literal("offers.unpublish") }),
  z.strictObject({ ...envelope, operation: z.literal("paymentOptions.save"), value: optionSchema.omit({ revision: true, archived: true }) }),
  z.strictObject({ ...archive, operation: z.literal("paymentOptions.archive") }),
  z.strictObject({ ...envelope, operation: z.literal("promotions.save"), value: promotionSchema.omit({ revision: true, archived: true }) }),
  z.strictObject({ ...archive, operation: z.literal("promotions.archive") }),
]);
export type ManageCatalogCommand = z.infer<typeof manageCatalogSchema>;
export const catalogOutcomeSchema = z.strictObject({ id: idSchema, revision: revisionSchema, archived: z.boolean(), published: z.boolean().optional() });
