import { z } from "zod";
import { idSchema, revisionSchema } from "../../domain/pricing.js";

const command = { operationId: idSchema, expectedRevision: revisionSchema };
export const changeMethodSchema = z.strictObject(command);
export const revokeMethodSchema = z.strictObject({ ...command, paymentMethodRef: idSchema });
export const methodFlowSchema = z.strictObject({
  flowRef: idSchema, state: z.enum(["started", "completed", "rejected"]),
  formUrl: z.url().nullable(), methodRef: idSchema.nullable(),
});
export type MethodFlowResult = z.infer<typeof methodFlowSchema>;
