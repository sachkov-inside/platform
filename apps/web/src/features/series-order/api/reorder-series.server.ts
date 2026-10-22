import "server-only";

import { z } from "zod";
import type {
  reorderSeriesInputSchema,
  ReorderSeriesResult,
} from "../model/presentation";

import { productRemovalsFromProblem } from "@/shared/lib/product-removal";
import {
  requestSeriesReorder,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

const receiptSchema = z
  .object({
    orderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    seriesId: z.uuid(),
  })
  .strict();

/** A body outside the input schema answers as the former form did. */
export function reorderSeriesInvalidInput(): ReorderSeriesResult {
  return { kind: "error", reference: "series-order-form" };
}

export async function executeReorderSeries(
  input: z.output<typeof reorderSeriesInputSchema>,
  accessToken: string,
  request: typeof requestSeriesReorder = requestSeriesReorder,
): Promise<ReorderSeriesResult> {
  const {
    chapterAssignments,
    chapters,
    confirmedProductRemovals,
    programmePlacements,
    stepGroups,
  } = input;
  let result: BackendTransportResult;
  try {
    result = await request(
      {
        expectedOrderVersion: input.expectedOrderVersion,
        orderedMaterialIds: input.orderedMaterialIds,
        ...(programmePlacements === undefined ? {} : { programmePlacements }),
        ...(stepGroups === undefined ? {} : { stepGroups }),
        ...(chapters === undefined ? {} : { chapters }),
        ...(chapterAssignments === undefined ? {} : { chapterAssignments }),
        ...(confirmedProductRemovals === undefined
          ? {}
          : { confirmedProductRemovals }),
        seriesId: input.seriesId,
      },
      accessToken,
    );
  } catch {
    return { kind: "error", reference: "backend-unavailable" };
  }
  if (!result.ok) {
    if (result.response.status === 401) return { kind: "unauthorized" };
    // 403 при действующей сессии: состав перенесённого продукта меняет только перенос, либо у
    // Account нет права автора. Вход заново этого не исправит.
    if (result.response.status === 403) return { kind: "forbidden" };
    if (result.response.status === 409) {
      const removals = productRemovalsFromProblem(result.problem);
      return removals === null
        ? { kind: "conflict" }
        : { products: removals, kind: "removal_confirmation_required" };
    }
    if (result.response.status === 422) {
      const mismatchedIds = sourceMismatchMaterialIds(
        result.problem,
        input.orderedMaterialIds,
      );
      if (mismatchedIds.length > 0)
        return { kind: "source_mismatch", materialIds: mismatchedIds };
    }
    return { kind: "error", reference: "series-order-save" };
  }
  const receipt = receiptSchema.safeParse(result.body);
  if (!receipt.success || receipt.data.seriesId !== input.seriesId) {
    return { kind: "error", reference: "series-order-receipt" };
  }
  return { kind: "saved", orderVersion: receipt.data.orderVersion };
}

const sourceMismatchProblemSchema = z.looseObject({
  code: z.literal("invalid_reference"),
  issues: z.array(z.looseObject({ code: z.string(), path: z.string() })),
});

/** Materials the backend refused because their source ownership differs from the Product. */
function sourceMismatchMaterialIds(
  problem: unknown,
  orderedMaterialIds: readonly string[],
): readonly string[] {
  const parsed = sourceMismatchProblemSchema.safeParse(problem);
  if (!parsed.success) return [];
  return parsed.data.issues.flatMap(({ code, path }) => {
    const index = /^\/orderedMaterialIds\/(\d+)$/u.exec(path)?.[1];
    const materialId =
      code === "material_source_mismatch" && index !== undefined
        ? orderedMaterialIds[Number(index)]
        : undefined;
    return materialId === undefined ? [] : [materialId];
  });
}
