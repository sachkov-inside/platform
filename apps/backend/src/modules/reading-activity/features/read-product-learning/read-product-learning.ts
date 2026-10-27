import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type {
  PublishedProductComposition,
  PublishedProductCompositionResult,
} from "../../../products/index.js";
import { readProgrammeMaterials } from "../../shared/product-progress.js";

/** At most this many Accounts in one read: a page of Product holders. */
export const PRODUCT_LEARNING_ACCOUNT_LIMIT = 100;

const querySchema = z.strictObject({
  productId: z.uuid().toLowerCase(),
  accountIds: z
    .array(z.uuid().toLowerCase())
    .max(PRODUCT_LEARNING_ACCOUNT_LIMIT),
});

export interface ProductLearning {
  readonly accountId: string;
  /** Programme Materials marked read, by the same rule as Product progress. */
  readonly readCount: number;
  /** Published programme Materials, by the same rule as Product progress. */
  readonly totalCount: number;
  /** When the Account first started this Product; `null` until it does. */
  readonly startedAt: string | null;
  /** The latest open of a programme Material; `null` when none was opened. */
  readonly lastActivityAt: string | null;
}

export type ReadProductLearningResult =
  | { readonly ok: true; readonly value: readonly ProductLearning[] }
  | Extract<PublishedProductCompositionResult, { readonly ok: false }>;

/**
 * Learning facts of many Accounts in one Product, aligned with the requested Accounts. This is
 * an internal read without an actor: its caller checks the right to see these Accounts. One
 * composition read and at most three grouped statements, whatever the number of Accounts.
 */
export async function readProductLearning(
  dependencies: {
    readonly prisma: ReadingActivityPrismaClient;
    readonly composition: Pick<
      PublishedProductComposition,
      "readIncludingArchived"
    >;
  },
  input: {
    readonly productId: string;
    readonly accountIds: readonly string[];
  },
): Promise<ReadProductLearningResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const { productId } = parsed.data;
  const accountIds = [...new Set(parsed.data.accountIds)];
  try {
    const composition =
      await dependencies.composition.readIncludingArchived(productId);
    if (!composition.ok) return composition;
    const programme = composition.value;
    if (accountIds.length === 0) return { ok: true, value: [] };
    const [read, visits, started] = await Promise.all([
      programme.length === 0
        ? []
        : dependencies.prisma.readingMaterialState.groupBy({
            by: ["accountId"],
            where: {
              accountId: { in: accountIds },
              ...readProgrammeMaterials(programme),
            },
            _count: { _all: true },
          }),
      programme.length === 0
        ? []
        : dependencies.prisma.readingMaterialVisit.groupBy({
            by: ["accountId"],
            where: {
              accountId: { in: accountIds },
              materialId: { in: [...programme] },
            },
            _max: { lastOpenedAt: true },
          }),
      dependencies.prisma.productLearningStarted.findMany({
        where: { productId, accountId: { in: accountIds } },
        select: { accountId: true, startedAt: true },
      }),
    ]);
    const readCounts = new Map(
      read.map((row) => [row.accountId.toLowerCase(), row._count._all]),
    );
    const lastOpens = new Map(
      visits.map((row) => [
        row.accountId.toLowerCase(),
        row._max.lastOpenedAt ?? null,
      ]),
    );
    const starts = new Map(
      started.map((row) => [row.accountId.toLowerCase(), row.startedAt]),
    );
    return {
      ok: true,
      value: accountIds.map((accountId) => ({
        accountId,
        readCount: readCounts.get(accountId) ?? 0,
        totalCount: programme.length,
        startedAt: starts.get(accountId)?.toISOString() ?? null,
        lastActivityAt: lastOpens.get(accountId)?.toISOString() ?? null,
      })),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "readProductLearning" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
