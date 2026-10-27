import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  Prisma,
  type ReadingActivityPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import type {
  PublishedProductComposition,
  PublishedProductCompositionResult,
} from "../../../products/index.js";

/** The largest holder set one summary reads, as Account Rights bounds it; more is refused. */
export const PRODUCT_LEARNING_SUMMARY_ACCOUNT_LIMIT = 50_000;

const querySchema = z.strictObject({
  productId: z.uuid().toLowerCase(),
  accountIds: z
    .array(z.uuid().toLowerCase())
    .max(PRODUCT_LEARNING_SUMMARY_ACCOUNT_LIMIT),
});

const totalsSchema = z.array(
  z.object({
    started: z.int().nonnegative(),
    read: z.coerce.number().int().nonnegative(),
  }),
);

export interface ProductLearningSummary {
  /** The distinct Accounts summarized. */
  readonly accounts: number;
  /** Of them, those with a `ProductLearningStarted` fact for the Product. */
  readonly started: number;
  /**
   * The mean of `readCount / totalCount` over the Accounts, by the rule of Product progress;
   * `null` without Accounts or without programme Materials.
   */
  readonly averageProgress: number | null;
}

export type SummarizeProductLearningResult =
  | { readonly ok: true; readonly value: ProductLearningSummary }
  | Extract<PublishedProductCompositionResult, { readonly ok: false }>;

/**
 * How one set of Accounts learns one Product, as totals (#1719): who started it and their mean
 * progress. Every Account shares the same programme, so the mean equals all read programme
 * Materials over Accounts times programme size. One composition read and one statement. An
 * internal read without an actor: its caller checks the right to see these Accounts.
 */
export async function summarizeProductLearning(
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
): Promise<SummarizeProductLearningResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const { productId } = parsed.data;
  const accountIds = [...new Set(parsed.data.accountIds)];
  try {
    const composition =
      await dependencies.composition.readIncludingArchived(productId);
    if (!composition.ok) return composition;
    const programme = [...composition.value];
    if (accountIds.length === 0)
      return {
        ok: true,
        value: { accounts: 0, started: 0, averageProgress: null },
      };
    const [totals] = totalsSchema.parse(
      await dependencies.prisma.$queryRaw(Prisma.sql`
        SELECT
          (SELECT count(*) FROM reading_activity.product_learning_started
            WHERE product_id = ${productId}::uuid
              AND account_id = ANY(${accountIds}::uuid[]))::int AS started,
          (SELECT count(*) FROM reading_activity.material_states
            WHERE is_read
              AND account_id = ANY(${accountIds}::uuid[])
              AND material_id = ANY(${programme}::uuid[]))::int8 AS read
      `),
    );
    if (totals === undefined) throw new Error("Learning totals are missing");
    return {
      ok: true,
      value: {
        accounts: accountIds.length,
        started: totals.started,
        averageProgress:
          programme.length === 0
            ? null
            : totals.read / (accountIds.length * programme.length),
      },
    };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "summarizeProductLearning" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } } as const,
    );
  }
}
