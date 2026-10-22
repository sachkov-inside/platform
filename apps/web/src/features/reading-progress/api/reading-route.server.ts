import "server-only";
import { z } from "zod";
import {
  requestReadingStates,
  requestSetReadingState,
} from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import { readingStateSchema } from "../model/reading-contract";
import {
  getReadingStatesOperation,
  setReadingStateOperation,
} from "./reading-progress.operation";

export function handleReadingStates(request: Request) {
  return handleMutationOperation(request, getReadingStatesOperation, {
    invalidInput: () => ({ kind: "invalid_input" }) as const,
    execute: async (input, token) => {
      try {
        const result = await requestReadingStates(input.materialIds, token);
        if (!result.ok)
          return {
            kind:
              result.response.status === 401 ? "unauthorized" : "unavailable",
          };
        const parsed = z
          .array(readingStateSchema)
          .max(100)
          .safeParse(result.body);
        return parsed.success
          ? { kind: "ready", states: parsed.data }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
export function handleSetReadingState(request: Request) {
  return handleMutationOperation(request, setReadingStateOperation, {
    invalidInput: () => ({ kind: "invalid_input" }) as const,
    execute: async (input, token) => {
      try {
        const result = await requestSetReadingState(input, token);
        if (result.ok) {
          const saved = z
            .object({
              state: readingStateSchema,
              replayed: z.boolean(),
              changed: z.boolean(),
            })
            .strict()
            .safeParse(result.body);
          return saved.success
            ? {
                kind: "saved",
                state: saved.data.state,
                replayed: saved.data.replayed,
              }
            : { kind: "unavailable" };
        }
        if (result.response.status === 409) {
          const conflict = z
            .object({ current: readingStateSchema.optional() })
            .safeParse(result.problem);
          return {
            kind: "conflict",
            current: conflict.success ? (conflict.data.current ?? null) : null,
          };
        }
        return {
          kind:
            result.response.status === 401
              ? "unauthorized"
              : result.response.status === 403
                ? "denied"
                : "unavailable",
        };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
