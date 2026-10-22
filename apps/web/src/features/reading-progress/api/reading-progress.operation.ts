import { z } from "zod";

import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  materialOpenCommandSchema,
  materialOpenResultSchema,
} from "../model/material-open-contract";
import { personalHomeResultSchema } from "../model/personal-home-contract";
import {
  readingCommandSchema,
  readingResultSchema,
  readingStatesResultSchema,
} from "../model/reading-contract";
import { seriesContinuationResultSchema } from "../model/series-continuation-contract";

function readerFailure(failure: MutationTransportFailure) {
  return {
    kind:
      failure.kind === "status" && failure.status === 401
        ? "unauthorized"
        : "unavailable",
  } as const;
}

/** Records that the reader opened a Material version. */
export const recordMaterialOpenOperation = defineMutationOperation({
  input: materialOpenCommandSchema,
  method: "POST",
  path: "/api/reading-progress/open",
  result: materialOpenResultSchema,
  transportFailure: readerFailure,
});

/**
 * Reads the personal Home. A guest sees it hidden; any other failure rejects, so the query keeps
 * its error state.
 */
export const loadPersonalHomeOperation = defineMutationOperation({
  input: z.object({}),
  method: "POST",
  path: "/api/personal-home",
  result: personalHomeResultSchema,
  transportFailure: (failure) => {
    if (failure.kind === "status" && failure.status === 401)
      return { kind: "hidden" } as const;
    throw new Error("Personal Home is unavailable");
  },
});

/** Reads where the reader continues a Product. */
export const loadSeriesContinuationOperation = defineMutationOperation({
  input: z.object({ slug: z.string().min(1).max(120) }),
  method: "POST",
  path: "/api/reading-progress/product-continuation",
  result: seriesContinuationResultSchema,
  transportFailure: (failure) =>
    ({
      kind:
        failure.kind === "status" && failure.status === 401
          ? "hidden"
          : "unavailable",
    }) as const,
});

/** Reads the reading state of up to a hundred Materials. */
export const getReadingStatesOperation = defineMutationOperation({
  input: z.object({ materialIds: z.array(z.uuid()).min(1).max(100) }),
  method: "POST",
  path: "/api/reading-progress/states",
  result: readingStatesResultSchema,
  transportFailure: readerFailure,
});

/** Marks a Material read or unread at the version the reader saw. */
export const setReadingStateOperation = defineMutationOperation({
  // Команда читает только свои поля, как прежняя форма; присланная личность отбрасывается.
  input: z.object(readingCommandSchema.shape),
  method: "PUT",
  path: "/api/reading-progress/state",
  result: readingResultSchema,
  transportFailure: readerFailure,
});
