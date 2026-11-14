import { glossaryTermIdSchema } from "@inside/material-blocks";
import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  TERM_MARKS_QUERY_MAX,
  termMarkCommandSchema,
  termMarkResultSchema,
  termMarksResultSchema,
} from "../model/term-mark-contract";

/** Reads the reader's marks on the terms of one deck. */
export const getTermMarksOperation = defineMutationOperation({
  input: z.object({
    termIds: z.array(glossaryTermIdSchema).min(1).max(TERM_MARKS_QUERY_MAX),
  }),
  method: "POST",
  path: "/api/glossary/marks/states",
  result: termMarksResultSchema.transform((result) =>
    result.kind === "ready"
      ? { kind: "ready" as const, marks: result.marks }
      : result.kind === "unauthorized"
        ? { kind: "unauthorized" as const }
        : { kind: "unavailable" as const },
  ),
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const },
});

/** Saves one «знаю» or «повторить» mark. */
export const setTermMarkOperation = defineMutationOperation({
  input: z.object(termMarkCommandSchema.shape),
  method: "PUT",
  path: "/api/glossary/marks/state",
  result: termMarkResultSchema.transform((result) =>
    result.kind === "ready"
      ? { kind: "ready" as const, mark: result.mark }
      : result.kind === "unauthorized"
        ? { kind: "unauthorized" as const }
        : { kind: "unavailable" as const },
  ),
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const },
});
