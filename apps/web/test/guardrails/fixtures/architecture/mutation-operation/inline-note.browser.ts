import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

export const pinNoteOperation = defineMutationOperation({
  input: z.object({ id: z.string() }),
  method: "POST",
  path: "/api/notes",
  result: z.object({ kind: z.literal("pinned") }),
  transportFailure: () => ({ kind: "pinned" as const }),
});
