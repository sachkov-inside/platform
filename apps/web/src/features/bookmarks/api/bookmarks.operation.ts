import { z } from "zod";

import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  bookmarkCommandSchema,
  bookmarkStateResultSchema,
  bookmarkStatesResultSchema,
} from "../model/bookmark-contract";

/** Reads the bookmark state of up to a hundred Materials. */
export const getBookmarkStatesOperation = defineMutationOperation({
  input: z.object({ materialIds: z.array(z.uuid()).min(1).max(100) }),
  method: "POST",
  path: "/api/bookmarks/states",
  result: bookmarkStatesResultSchema.transform((result) =>
    result.kind === "ready"
      ? { kind: "ready" as const, states: result.states }
      : result.kind === "unauthorized"
        ? { kind: "unauthorized" as const }
        : { kind: "unavailable" as const },
  ),
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : { kind: "unavailable" as const },
});

/** Saves or removes one bookmark. */
export const setBookmarkOperation = defineMutationOperation({
  // Как и прежняя форма, команда читает только свои поля: присланная личность отбрасывается.
  input: z.object(bookmarkCommandSchema.shape),
  method: "PUT",
  path: "/api/bookmarks/state",
  result: bookmarkStateResultSchema.transform((result) =>
    result.kind === "ready"
      ? { kind: "ready" as const, state: result.state }
      : result.kind === "denied"
        ? { kind: "denied" as const }
        : result.kind === "unauthorized"
          ? { kind: "unauthorized" as const }
          : { kind: "unavailable" as const },
  ),
  transportFailure: (failure) =>
    failure.kind === "status" && failure.status === 401
      ? { kind: "unauthorized" as const }
      : failure.kind === "status" && failure.status === 403
        ? { kind: "denied" as const }
        : { kind: "unavailable" as const },
});
