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
  firstIssuedAt: z.iso.datetime().nullable(),
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
    .min(1)
    .max(1024)
    .regex(/^[A-Za-z0-9_-]+$/)
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
  id: z.uuid(),
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

const productAccessCursorSchema = z.strictObject({
  version: z.literal(1),
  sort: z.literal("account-product-asc"),
  scope: z.strictObject({
    accountId: z.uuid().nullable(),
    productId: z.uuid().nullable(),
  }),
  after: z.tuple([z.uuid(), z.uuid()]),
});

type ProductAccessListScope = {
  accountId: string | null;
  productId: string | null;
};

export function productAccessListScope(query: {
  accountId?: string | undefined;
  productId?: string | undefined;
}): ProductAccessListScope {
  return {
    accountId: query.accountId?.toLowerCase() ?? null,
    productId: query.productId?.toLowerCase() ?? null,
  };
}

export function decodeProductAccessCursor(
  value: string,
  scope: ProductAccessListScope,
): readonly [string, string] | null {
  try {
    const cursor = productAccessCursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (
      !cursor.success ||
      (cursor.data.scope.accountId?.toLowerCase() ?? null) !==
        scope.accountId ||
      (cursor.data.scope.productId?.toLowerCase() ?? null) !== scope.productId
    )
      return null;
    return [
      cursor.data.after[0].toLowerCase(),
      cursor.data.after[1].toLowerCase(),
    ];
  } catch {
    // Not a dependency failure: malformed caller cursor data is invalid input.
    return null;
  }
}

export function encodeProductAccessCursor(
  scope: ProductAccessListScope,
  after: readonly [string, string],
): string {
  return Buffer.from(
    JSON.stringify({ version: 1, sort: "account-product-asc", scope, after }),
  ).toString("base64url");
}
