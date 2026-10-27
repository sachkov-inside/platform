import { createHash } from "node:crypto";
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
/** At most this many Accounts in one `accountIds` filter (a page of selected people). */
export const PRODUCT_ACCESS_LIST_ACCOUNT_LIMIT = 50;
export const productAccessListQuerySchema = z.strictObject({
  accountId: z.uuid().optional(),
  productId: z.uuid().optional(),
  /** `active`: not revoked now; `revoked`: revoked now. Absent: both. */
  access: z.enum(["active", "revoked"]).optional(),
  /** `recent`: first issue newest first, never-issued rows last, then Account and Product id. */
  order: z.literal("recent").optional(),
  /** Only these Accounts; an Account without a Product Access row is simply absent. */
  accountIds: z
    .array(z.uuid())
    .min(1)
    .max(PRODUCT_ACCESS_LIST_ACCOUNT_LIMIT)
    .optional(),
  cursor: z.base64url().min(1).max(1024).optional(),
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

const productAccessCursorScopeSchema = z.strictObject({
  accountId: z.uuid().nullable(),
  productId: z.uuid().nullable(),
  // Cursors issued before these filters existed carry neither field and mean "no filter".
  access: z.enum(["active", "revoked"]).nullable().default(null),
  accountIds: z.hash("sha256", { enc: "base64url" }).nullable().default(null),
});
const productAccessCursorSchema = z.discriminatedUnion("sort", [
  z.strictObject({
    version: z.literal(1),
    sort: z.literal("account-product-asc"),
    scope: productAccessCursorScopeSchema,
    after: z.tuple([z.uuid(), z.uuid()]),
  }),
  z.strictObject({
    version: z.literal(1),
    sort: z.literal("recent"),
    scope: productAccessCursorScopeSchema,
    after: z.tuple([z.iso.datetime().nullable(), z.uuid(), z.uuid()]),
  }),
]);

export type ProductAccessListScope = {
  readonly accountId: string | null;
  readonly productId: string | null;
  readonly access: "active" | "revoked" | null;
  /** Canonical, deduplicated and sorted; `null` when the filter is absent. */
  readonly accountIds: readonly string[] | null;
};

/** The position after the last row of a page, in the order the scope's sort defines. */
export type ProductAccessListPosition =
  | {
      readonly sort: "account-product-asc";
      readonly after: readonly [string, string];
    }
  | {
      readonly sort: "recent";
      /** First issue truncated to milliseconds, the precision the order compares. */
      readonly after: readonly [string | null, string, string];
    };

export function productAccessListScope(query: {
  accountId?: string | undefined;
  productId?: string | undefined;
  access?: "active" | "revoked" | undefined;
  accountIds?: readonly string[] | undefined;
}): ProductAccessListScope {
  return {
    accountId: query.accountId?.toLowerCase() ?? null,
    productId: query.productId?.toLowerCase() ?? null,
    access: query.access ?? null,
    accountIds:
      query.accountIds === undefined
        ? null
        : [...new Set(query.accountIds.map((id) => id.toLowerCase()))].sort(),
  };
}

/** The cursor binds the Account set by digest, so fifty ids never outgrow the cursor bound. */
function accountSetDigest(accountIds: readonly string[] | null) {
  return accountIds === null
    ? null
    : createHash("sha256").update(accountIds.join(",")).digest("base64url");
}

export function decodeProductAccessCursor(
  value: string,
  scope: ProductAccessListScope,
  sort: ProductAccessListPosition["sort"],
): ProductAccessListPosition | null {
  try {
    const cursor = productAccessCursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    if (
      !cursor.success ||
      cursor.data.sort !== sort ||
      (cursor.data.scope.accountId?.toLowerCase() ?? null) !==
        scope.accountId ||
      (cursor.data.scope.productId?.toLowerCase() ?? null) !==
        scope.productId ||
      cursor.data.scope.access !== scope.access ||
      cursor.data.scope.accountIds !== accountSetDigest(scope.accountIds)
    )
      return null;
    return cursor.data.sort === "recent"
      ? {
          sort: "recent",
          after: [
            cursor.data.after[0] === null
              ? null
              : new Date(cursor.data.after[0]).toISOString(),
            cursor.data.after[1].toLowerCase(),
            cursor.data.after[2].toLowerCase(),
          ],
        }
      : {
          sort: "account-product-asc",
          after: [
            cursor.data.after[0].toLowerCase(),
            cursor.data.after[1].toLowerCase(),
          ],
        };
  } catch {
    // Not a dependency failure: malformed caller cursor data is invalid input.
    return null;
  }
}

export function encodeProductAccessCursor(
  scope: ProductAccessListScope,
  position: ProductAccessListPosition,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      sort: position.sort,
      scope: {
        accountId: scope.accountId,
        productId: scope.productId,
        access: scope.access,
        accountIds: accountSetDigest(scope.accountIds),
      },
      after: position.after,
    }),
  ).toString("base64url");
}
