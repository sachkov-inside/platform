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
