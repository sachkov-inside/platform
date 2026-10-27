import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";

/** One page of a people list. */
export const LAST_ACTIVITY_ACCOUNTS_LIMIT = 50;

export type ReadLastActivityResult =
  | {
      readonly ok: true;
      /** Requested spelling to the latest Material open, `null` when the Account opened none. */
      readonly accounts: ReadonlyMap<string, string | null>;
    }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

/** The latest Material open of each requested Account, in one statement. */
export async function readLastActivity(
  prisma: ReadingActivityPrismaClient,
  accountIds: readonly string[],
): Promise<ReadLastActivityResult> {
  const parsed = z
    .array(z.uuid())
    .max(LAST_ACTIVITY_ACCOUNTS_LIMIT)
    .safeParse(accountIds);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const ids = [...new Set(parsed.data.map((id) => id.toLowerCase()))];
  try {
    const rows =
      ids.length === 0
        ? []
        : await prisma.readingMaterialVisit.groupBy({
            by: ["accountId"],
            where: { accountId: { in: ids } },
            _max: { lastOpenedAt: true },
          });
    const latest = new Map(
      rows.map((row) => [
        row.accountId,
        row._max.lastOpenedAt?.toISOString() ?? null,
      ]),
    );
    return {
      ok: true,
      accounts: new Map(
        parsed.data.map((id) => [id, latest.get(id.toLowerCase()) ?? null]),
      ),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "readLastActivity" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
