import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

// Маршрут /api/notes не объявляет PUT.
export const renameNoteOperation = defineMutationOperation({
  input: z.object({ text: z.string() }),
  method: "PUT",
  path: "/api/notes",
  result: z.object({ kind: z.literal("renamed") }),
  transportFailure: () => ({ kind: "renamed" as const }),
});
