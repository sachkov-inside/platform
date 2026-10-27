import { defineMutationOperation } from "@/shared/api/mutation-operation";

import { homePinResultSchema, setHomePinInputSchema } from "../model/home-pin";
import {
  chapterAttachmentsInputSchema,
  reorderProductInputSchema,
  reorderProductResultSchema,
  type ReorderProductResult,
} from "../model/presentation";

/** Saves a Product composition at the order version the author saw. */
export const reorderProductOperation = defineMutationOperation({
  input: reorderProductInputSchema,
  method: "PUT",
  path: "/api/authoring/products/order",
  result: reorderProductResultSchema,
  transportFailure: (failure): ReorderProductResult =>
    failure.kind === "contract"
      ? { kind: "error", reference: "product-order-bff-contract" }
      : failure.status === 401 || failure.status === 403
        ? { kind: "unauthorized" }
        : {
            kind: "error",
            reference: `product-order-bff-${String(failure.status)}`,
          },
});

/** Saves the supplementary Materials of one Product chapter. */
export const updateChapterAttachmentsOperation = defineMutationOperation({
  input: chapterAttachmentsInputSchema,
  method: "PUT",
  path: "/api/authoring/products/chapter-attachments",
  result: reorderProductResultSchema,
  transportFailure: (failure): ReorderProductResult =>
    failure.kind === "contract"
      ? { kind: "error", reference: "chapter-attachments-response" }
      : failure.status === 401
        ? { kind: "unauthorized" }
        : { kind: "error", reference: "chapter-attachments-unavailable" },
});

/** Pins a Product to Home or clears the pin at the version the author saw. */
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
