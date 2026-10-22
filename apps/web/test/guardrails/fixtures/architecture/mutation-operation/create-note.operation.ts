import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

export const createNoteOperation = defineMutationOperation({
  input: z.object({ text: z.string() }),
  method: "POST",
  path: "/api/notes",
  result: z.object({ kind: z.literal("created") }),
  transportFailure: () => ({ kind: "created" as const }),
});
