import "server-only";

import { z } from "zod";

import {
  productChapterDraftSchema,
  type ReorderSeriesResult,
} from "@/features/series-order";
import { productRemovalsFromProblem } from "@/shared/lib/product-removal";
import {
  requestSeriesReorder,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

const formSchema = z.object({
  expectedOrderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
  orderedMaterialIds: z.string().max(1_000_000),
  seriesId: z.uuid(),
});
const receiptSchema = z
  .object({
    orderVersion: z.string().regex(/^[a-f0-9]{64}$/u),
    seriesId: z.uuid(),
  })
  .strict();

export async function executeReorderSeries(
  formData: FormData,
  accessToken: string,
  request: typeof requestSeriesReorder = requestSeriesReorder,
): Promise<ReorderSeriesResult> {
  const parsed = formSchema.safeParse({
    expectedOrderVersion: formData.get("expectedOrderVersion"),
    orderedMaterialIds: formData.get("orderedMaterialIds"),
    seriesId: formData.get("seriesId"),
  });
  if (!parsed.success) return { kind: "error", reference: "series-order-form" };
  let materialIds: unknown;
  try {
    materialIds = JSON.parse(parsed.data.orderedMaterialIds) as unknown;
  } catch {
    return { kind: "error", reference: "series-order-form" };
  }
  const orderedMaterialIds = z.array(z.uuid()).safeParse(materialIds);
  if (!orderedMaterialIds.success) {
    return { kind: "error", reference: "series-order-form" };
  }

  const stepGroups = readJsonField(
    formData,
    "stepGroups",
    z.record(z.uuid(), z.string().trim().min(1).max(120)),
  );
  const chapters = readJsonField(
    formData,
    "chapters",
    z.array(productChapterDraftSchema),
  );
  const chapterAssignments = readJsonField(
    formData,
    "chapterAssignments",
    z.record(z.uuid(), z.uuid()),
  );
  const confirmedProductRemovals = readJsonField(
    formData,
    "confirmedProductRemovals",
    z.array(z.uuid()).min(1).max(100),
  );
  if (
    stepGroups === invalidField ||
    chapters === invalidField ||
    chapterAssignments === invalidField ||
    confirmedProductRemovals === invalidField
  ) {
    return { kind: "error", reference: "series-order-form" };
  }

  let result: BackendTransportResult;
  try {
    result = await request(
      {
        expectedOrderVersion: parsed.data.expectedOrderVersion,
        orderedMaterialIds: orderedMaterialIds.data,
        ...(stepGroups === undefined ? {} : { stepGroups }),
        ...(chapters === undefined ? {} : { chapters }),
        ...(chapterAssignments === undefined ? {} : { chapterAssignments }),
        ...(confirmedProductRemovals === undefined
          ? {}
          : { confirmedProductRemovals }),
        seriesId: parsed.data.seriesId,
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
        orderedMaterialIds.data,
      );
      if (mismatchedIds.length > 0)
        return { kind: "source_mismatch", materialIds: mismatchedIds };
    }
    return { kind: "error", reference: "series-order-save" };
  }
  const receipt = receiptSchema.safeParse(result.body);
  if (!receipt.success || receipt.data.seriesId !== parsed.data.seriesId) {
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

const invalidField = Symbol("invalid-series-order-field");

/** Optional JSON-encoded form fields stay absent, valid, or an explicit rejection. */
function readJsonField<Value>(
  formData: FormData,
  name: string,
  schema: z.ZodType<Value>,
): Value | undefined | typeof invalidField {
  const value = formData.get(name);
  if (value === null) return undefined;
  if (typeof value !== "string") return invalidField;
  try {
    return schema.parse(JSON.parse(value) as unknown);
  } catch {
    return invalidField;
  }
}
