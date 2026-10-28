import { z } from "zod";
import type { Accounts } from "../../../accounts/index.js";
import type { AccessGrants } from "../../../account-rights/index.js";
import type { ReadingActivity } from "../../../reading-activity/index.js";

/** The page bound of the holders list; the web shows 20 rows by default. */
export const PRODUCT_HOLDERS_PAGE_LIMIT = 50;

export const productHoldersQuerySchema = z.strictObject({
  productId: z.uuid(),
  cursor: z.base64url().min(1).max(1024).optional(),
  limit: z.int().min(1).max(PRODUCT_HOLDERS_PAGE_LIMIT).default(20),
  access: z.enum(["active", "revoked"]).optional(),
  accountIds: z
    .array(z.uuid())
    .min(1)
    .max(PRODUCT_HOLDERS_PAGE_LIMIT)
    .optional(),
});
export type ProductHoldersQuery = z.input<typeof productHoldersQuerySchema>;

export const productHolderLearningSchema = z.strictObject({
  readCount: z
    .int()
    .nonnegative()
    .describe("Programme Materials marked read, the rule of Product progress"),
  totalCount: z
    .int()
    .nonnegative()
    .describe("Published programme Materials, the rule of Product progress"),
  startedAt: z.iso
    .datetime()
    .nullable()
    .describe("When the Account started the Product; null until it does"),
  lastActivityAt: z.iso
    .datetime()
    .nullable()
    .describe("The latest open of a programme Material; null when none"),
});

export const productHolderSchema = z.strictObject({
  accountId: z.uuid(),
  access: z.enum(["active", "revoked"]),
  firstIssuedAt: z.iso.datetime().nullable(),
  revision: z.int().positive(),
  learning: productHolderLearningSchema,
});

export const productHoldersPageSchema = z.strictObject({
  items: z.array(productHolderSchema),
  nextCursor: z.string().nullable(),
});
export type ProductHoldersPage = z.infer<typeof productHoldersPageSchema>;

export type ListProductHoldersResult =
  | { readonly ok: true; readonly value: ProductHoldersPage }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          | "invalid_request"
          | "forbidden"
          | "product_not_found"
          | "dependency_unavailable";
      };
    };

/**
 * Holders of one Product, newest first, with their learning. `billing:manage` reads it, as the
 * other access reads. The right is checked before the request is read, so another role gets a
 * refusal for any input and never an empty page or a validation answer; Product Access checks
 * it again before any row. Names and emails are not here: the web joins identity
 * through the people read, which checks its own right.
 */
export async function listProductHolders(
  dependencies: {
    readonly accounts: Pick<Accounts, "checkPermission">;
    readonly grants: Pick<AccessGrants, "listProductAccess">;
    readonly reading: Pick<ReadingActivity, "readProductLearning">;
  },
  actorId: string,
  /** `null`: the transport could not read the request; it is refused or rejected after the right. */
  input: ProductHoldersQuery | null,
): Promise<ListProductHoldersResult> {
  const decision = await dependencies.accounts.checkPermission({
    accountId: actorId,
    permission: "billing:manage",
  });
  if (!decision.ok) return failure("dependency_unavailable");
  if (!decision.allowed) return failure("forbidden");
  if (input === null) return failure("invalid_request");
  const query = productHoldersQuerySchema.safeParse(input);
  if (!query.success) return failure("invalid_request");
  const { productId, cursor, limit, access, accountIds } = query.data;
  const page = await dependencies.grants.listProductAccess(actorId, {
    productId,
    order: "recent",
    limit,
    ...(cursor === undefined ? {} : { cursor }),
    ...(access === undefined ? {} : { access }),
    ...(accountIds === undefined ? {} : { accountIds }),
  });
  if (!page.ok)
    return failure(
      page.error.code === "forbidden"
        ? "forbidden"
        : page.error.code === "invalid_input"
          ? "invalid_request"
          : "dependency_unavailable",
    );
  const learning = await dependencies.reading.readProductLearning({
    productId,
    accountIds: page.value.map((row) => row.accountId),
  });
  if (!learning.ok)
    return failure(
      learning.error.code === "product_not_found"
        ? "product_not_found"
        : learning.error.code === "invalid_request"
          ? "invalid_request"
          : "dependency_unavailable",
    );
  const byAccount = new Map(
    learning.value.map((entry) => [entry.accountId, entry]),
  );
  const items = [];
  for (const row of page.value) {
    const facts = byAccount.get(row.accountId.toLowerCase());
    if (facts === undefined) return failure("dependency_unavailable");
    items.push({
      accountId: row.accountId,
      access: row.access,
      firstIssuedAt: row.firstIssuedAt,
      revision: row.revision,
      learning: {
        readCount: facts.readCount,
        totalCount: facts.totalCount,
        startedAt: facts.startedAt,
        lastActivityAt: facts.lastActivityAt,
      },
    });
  }
  return { ok: true, value: { items, nextCursor: page.nextCursor } };
}

function failure(
  code: Extract<ListProductHoldersResult, { ok: false }>["error"]["code"],
): ListProductHoldersResult {
  return { ok: false, error: { code } };
}
