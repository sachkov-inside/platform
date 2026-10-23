import { z } from "zod";
import {
  instantSchema,
  reasonSchema,
  sourceRefSchema,
} from "./access-grant.js";
export const issueProductAccessSchema = z.strictObject({
  accountId: z.uuid(),
  productId: z.uuid(),
  sourceRef: sourceRefSchema,
  issuedAt: instantSchema,
  reason: reasonSchema,
});
export type IssueProductAccessCommand = z.input<
  typeof issueProductAccessSchema
>;
export const productAccessContextSchema = z.strictObject({
  source: z.enum(["purchase", "course_activation", "manual"]),
  actorId: z.uuid().optional(),
});
export type ProductAccessContext = z.infer<typeof productAccessContextSchema>;
export const productAccessViewSchema = z.strictObject({
  accountId: z.uuid(),
  productId: z.uuid(),
  firstIssuedAt: z.iso.datetime(),
  access: z.enum(["active", "revoked"]),
  revision: z.int().positive(),
});
export const productAccessChangeSchema = z.strictObject({
  accountId: z.uuid(),
  productId: z.uuid(),
  operationId: z.uuid(),
  expectedRevision: z.int().nonnegative(),
  reason: reasonSchema,
});
export const productAccessTargetSchema = z.strictObject({
  accountId: z.uuid(),
  productId: z.uuid(),
});
export const productAccessListQuerySchema = z.strictObject({
  accountId: z.uuid().optional(),
  productId: z.uuid().optional(),
  cursor: z
    .string()
    .refine((value) => {
      const ids = value.split(":");
      return (
        ids.length === 2 && ids.every((id) => z.uuid().safeParse(id).success)
      );
    })
    .optional(),
  limit: z.int().min(1).max(100).default(50),
});
export const productAccessListSchema = z.strictObject({
  value: z.array(productAccessViewSchema),
  nextCursor: z.string().nullable(),
});
export const productAccessSourceSchema = z.strictObject({
  source: z.string(),
  sourceRef: z.string(),
  issuedAt: z.iso.datetime(),
  reason: z.string(),
});
export const productAccessActionSchema = z.strictObject({
  kind: z.string(),
  actorId: z.uuid().nullable(),
  reason: z.string(),
  recordedAt: z.iso.datetime(),
  revision: z.int().positive(),
});
export const productAccessRecordsSchema = productAccessViewSchema.extend({
  sources: z.array(productAccessSourceSchema),
  actions: z.array(productAccessActionSchema),
});

export const issueManualProductAccessSchema = issueProductAccessSchema.omit({
  issuedAt: true,
});
