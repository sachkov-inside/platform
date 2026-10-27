import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ReadingActivityPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { PublishedProductComposition } from "../../../products/index.js";

/** The Products of one person card; more is refused rather than cut. */
export const LEARNING_SUMMARY_PRODUCTS_LIMIT = 50;
/** Material IDs per reading statement. */
const MATERIAL_CHUNK = 1000;

export interface LearningSummary {
  readonly productId: string;
  /** When the learner first started the Product (Product Learning Started). */
  readonly startedAt: string | null;
  /**
   * Progress over the published composition, read without the learner's access so a revoked
   * Product still shows it. `unavailable` when the composition is not published to everyone
   * (archived or removed Product) or exceeds its bound.
   */
  readonly progress:
    | {
        readonly state: "measured";
        readonly read: number;
        readonly total: number;
        /** The latest open of a Material of this composition. */
        readonly lastActivityAt: string | null;
      }
    | { readonly state: "unavailable" };
}

export type ReadLearningSummaryResult =
  | { readonly ok: true; readonly value: readonly LearningSummary[] }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request" }
        | { readonly code: "dependency_unavailable" };
    };

const querySchema = z.strictObject({
  accountId: z.uuid().toLowerCase(),
  productIds: z.array(z.uuid()).max(LEARNING_SUMMARY_PRODUCTS_LIMIT),
});

/**
 * Learning facts of one Account for each requested Product, in request order with the
 * requested spelling. Total and read count come from the published composition alone: an owner
 * sees the learner's progress whatever the learner's current access is.
 */
export async function readLearningSummary(
  dependencies: {
    readonly prisma: ReadingActivityPrismaClient;
    readonly composition: Pick<PublishedProductComposition, "read">;
  },
  input: { readonly accountId: string; readonly productIds: readonly string[] },
): Promise<ReadLearningSummaryResult> {
  const parsed = querySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const { accountId } = parsed.data;
  const productIds = [
    ...new Set(parsed.data.productIds.map((id) => id.toLowerCase())),
  ];
  try {
    const compositions = new Map<string, readonly string[] | null>();
    // The composition owner has no set read: one call per Product, in sequence, at most
    // LEARNING_SUMMARY_PRODUCTS_LIMIT (50) calls per summary.
    for (const productId of productIds) {
      const composition = await dependencies.composition.read(productId);
      if (composition.ok) compositions.set(productId, composition.value);
      else if (composition.error.code === "dependency_unavailable")
        return { ok: false, error: { code: "dependency_unavailable" } };
      else compositions.set(productId, null);
    }
    const materialIds = [
      ...new Set(
        [...compositions.values()].flatMap((ids) =>
          (ids ?? []).map((id) => id.toLowerCase()),
        ),
      ),
    ];
    const read = new Set<string>();
    const opened = new Map<string, Date>();
    for (
      let offset = 0;
      offset < materialIds.length;
      offset += MATERIAL_CHUNK
    ) {
      const chunk = materialIds.slice(offset, offset + MATERIAL_CHUNK);
      const states = await dependencies.prisma.readingMaterialState.findMany({
        where: { accountId, materialId: { in: chunk }, isRead: true },
        select: { materialId: true },
      });
      for (const state of states) read.add(state.materialId);
      const visits = await dependencies.prisma.readingMaterialVisit.findMany({
        where: { accountId, materialId: { in: chunk } },
        select: { materialId: true, lastOpenedAt: true },
      });
      for (const visit of visits)
        opened.set(visit.materialId, visit.lastOpenedAt);
    }
    const started = await dependencies.prisma.productLearningStarted.findMany({
      where: { accountId, productId: { in: productIds } },
      select: { productId: true, startedAt: true },
    });
    const startedAt = new Map(
      started.map((row) => [row.productId, row.startedAt.toISOString()]),
    );
    return {
      ok: true,
      value: parsed.data.productIds.map((requested): LearningSummary => {
        const productId = requested.toLowerCase();
        const composition = compositions.get(productId) ?? null;
        if (composition === null)
          return {
            productId: requested,
            startedAt: startedAt.get(productId) ?? null,
            progress: { state: "unavailable" },
          };
        const ids = composition.map((id) => id.toLowerCase());
        const last = ids.reduce<Date | null>((latest, id) => {
          const at = opened.get(id);
          return at !== undefined && (latest === null || at > latest)
            ? at
            : latest;
        }, null);
        return {
          productId: requested,
          startedAt: startedAt.get(productId) ?? null,
          progress: {
            state: "measured",
            read: ids.filter((id) => read.has(id)).length,
            total: ids.length,
            lastActivityAt: last?.toISOString() ?? null,
          },
        };
      }),
    };
  } catch (error) {
    return dependencyFailure(
      { module: "reading-activity", operation: "readLearningSummary" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } },
    );
  }
}
