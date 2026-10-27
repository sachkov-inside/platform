import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { accessFailure } from "../../domain/access-grant.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import {
  listAccountsWithProductAccess,
  productAccessOriginSchema,
} from "../../shared/product-access-origins.js";

/** The largest Account set one filter answers; a larger set is refused, never truncated. */
export const ACCESS_ACCOUNTS_LIMIT = 50_000;

export const accessAccountsFilterSchema = z.strictObject({
  productId: z.uuid().toLowerCase().optional(),
  /** Compared with the first acquisition origin of a Product Access. */
  origin: productAccessOriginSchema.optional(),
  state: z.enum(["active", "revoked"]).optional(),
});

/**
 * The complete set of Accounts holding at least one Product Access that matches every given
 * filter together, ascending by Account ID. Above {@link ACCESS_ACCOUNTS_LIMIT} Accounts the read
 * fails as unavailable and records why, so a caller never mistakes a cut set for the whole one.
 */
export async function listAccessAccounts(
  prisma: AccountRightsPrismaClient,
  input: unknown,
) {
  const filter = accessAccountsFilterSchema.safeParse(input);
  if (!filter.success) return accessFailure("invalid_input");
  const accountIds = await listAccountsWithProductAccess(
    prisma,
    filter.data,
    ACCESS_ACCOUNTS_LIMIT + 1,
  );
  if (accountIds.length > ACCESS_ACCOUNTS_LIMIT)
    return dependencyFailure(
      { module: "account-rights", operation: "listAccessAccounts" },
      new RangeError("Product Access Account set exceeds its bound"),
      accessFailure("unavailable"),
    );
  return { ok: true as const, accountIds };
}
