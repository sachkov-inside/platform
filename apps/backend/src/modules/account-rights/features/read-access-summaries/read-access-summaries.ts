import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { accessFailure } from "../../domain/access-grant.js";
import type { AccountRightsPrismaClient } from "../../infrastructure/prisma.js";
import {
  readFirstAcquisitionOrigins,
  type ProductAccessOrigin,
} from "../../shared/product-access-origins.js";

/** One page of a people list: the most Accounts one summary read answers. */
export const ACCESS_SUMMARY_ACCOUNTS_LIMIT = 50;
/** The Product Access bound of one Account, as capability resolution enforces it. */
const PRODUCT_ACCESS_PER_ACCOUNT_LIMIT = 1000;

export interface ProductAccessSummary {
  readonly productId: string;
  readonly access: "active" | "revoked";
  /** How the Product Access was first acquired. */
  readonly origin: ProductAccessOrigin;
}

/**
 * Every Product Access of each requested Account with its state and first acquisition origin.
 * Keys keep the requested spelling; an Account without Product Access maps to an empty list.
 */
export async function readAccessSummaries(
  prisma: AccountRightsPrismaClient,
  input: readonly string[],
) {
  const parsed = z
    .array(z.uuid())
    .max(ACCESS_SUMMARY_ACCOUNTS_LIMIT)
    .safeParse(input);
  if (!parsed.success) return accessFailure("invalid_input");
  const ids = [...new Set(parsed.data.map((id) => id.toLowerCase()))];
  const limit = ids.length * PRODUCT_ACCESS_PER_ACCOUNT_LIMIT;
  const rows = await readFirstAcquisitionOrigins(prisma, ids, limit + 1);
  if (rows.length > limit)
    return dependencyFailure(
      { module: "account-rights", operation: "readAccessSummaries" },
      new RangeError("Product Access summaries exceed their bound"),
      accessFailure("unavailable"),
    );
  const byAccount = new Map<string, ProductAccessSummary[]>(
    ids.map((id) => [id, []]),
  );
  for (const row of rows)
    byAccount.get(row.accountId)?.push({
      productId: row.productId,
      access: row.active ? "active" : "revoked",
      origin: row.origin,
    });
  return {
    ok: true as const,
    accounts: new Map<string, readonly ProductAccessSummary[]>(
      parsed.data.map((id) => [id, byAccount.get(id.toLowerCase()) ?? []]),
    ),
  };
}
