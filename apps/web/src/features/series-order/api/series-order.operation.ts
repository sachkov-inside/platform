import { defineMutationOperation } from "@/shared/api/mutation-operation";

import { homePinResultSchema, setHomePinInputSchema } from "../model/home-pin";
import {
  chapterAttachmentsInputSchema,
  reorderSeriesInputSchema,
  reorderSeriesResultSchema,
  type ReorderSeriesResult,
} from "../model/presentation";

/** Saves a Product composition at the order version the author saw. */
export const reorderSeriesOperation = defineMutationOperation({
  input: reorderSeriesInputSchema,
  method: "PUT",
  path: "/api/authoring/products/order",
  result: reorderSeriesResultSchema,
  transportFailure: (failure): ReorderSeriesResult =>
    failure.kind === "contract"
      ? { kind: "error", reference: "series-order-bff-contract" }
      : failure.status === 401 || failure.status === 403
        ? { kind: "unauthorized" }
        : {
            kind: "error",
            reference: `series-order-bff-${String(failure.status)}`,
          },
});

/** Saves the supplementary Materials of one Product chapter. */
export const updateChapterAttachmentsOperation = defineMutationOperation({
  input: chapterAttachmentsInputSchema,
  method: "PUT",
  path: "/api/authoring/products/chapter-attachments",
  result: reorderSeriesResultSchema,
  transportFailure: (failure): ReorderSeriesResult =>
    failure.kind === "contract"
      ? { kind: "error", reference: "chapter-attachments-response" }
      : failure.status === 401
        ? { kind: "unauthorized" }
        : { kind: "error", reference: "chapter-attachments-unavailable" },
});

/** Pins a Series to Home or clears the pin at the version the author saw. */
export const setHomePinOperation = defineMutationOperation({
  input: setHomePinInputSchema,
  method: "PUT",
  path: "/api/authoring/home-pin",
  result: homePinResultSchema,
  transportFailure: (failure) =>
    ({
      kind:
        failure.kind === "status" && failure.status === 401
          ? "unauthorized"
          : "unavailable",
    }) as const,
});
