import "server-only";
import { requestResetReadingProgress } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import { progressResetSavedSchema } from "../model/progress-reset-contract";
import { resetReadingProgressOperation } from "./reading-progress.operation";

/** Starts a chapter over for the signed-in reader: studied marks and opened lesson parts. */
export function handleProgressReset(request: Request) {
  return handleMutationOperation(request, resetReadingProgressOperation, {
    invalidInput: () => ({ kind: "invalid_input" }) as const,
    execute: async (input, token) => {
      try {
        const response = await requestResetReadingProgress(input, token);
        if (!response.ok)
          return {
            kind:
              response.response.status === 401
                ? "unauthorized"
                : response.response.status === 400
                  ? "invalid_input"
                  : "unavailable",
          } as const;
        const saved = progressResetSavedSchema.safeParse(response.body);
        return saved.success
          ? { kind: "reset", resetCount: saved.data.resetCount }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
