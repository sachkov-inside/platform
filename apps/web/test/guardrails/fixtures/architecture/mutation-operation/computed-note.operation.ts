import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

const notesPath = "/api/notes";

export const archiveNoteOperation = defineMutationOperation({
  input: z.object({ id: z.string() }),
  method: "POST",
  path: notesPath,
  result: z.object({ kind: z.literal("archived") }),
  transportFailure: () => ({ kind: "archived" as const }),
});
