import "server-only";
import { requestRecordLessonOpenedParts } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import { openedPartsSavedSchema } from "../model/opened-parts-contract";
import { recordOpenedPartsOperation } from "./reading-progress.operation";

/** Saves the signed-in reader's opened parts of a step-by-step lesson (#2122). */
export function handleOpenedParts(request: Request) {
  return handleMutationOperation(request, recordOpenedPartsOperation, {
    invalidInput: () => ({ kind: "invalid_input" }) as const,
    execute: async (input, token) => {
      try {
        const response = await requestRecordLessonOpenedParts(input, token);
        if (!response.ok)
          return {
            kind:
              response.response.status === 401
                ? "unauthorized"
                : response.response.status === 403
                  ? "denied"
                  : response.response.status === 400
                    ? "invalid_input"
                    : "unavailable",
          } as const;
        const saved = openedPartsSavedSchema.safeParse(response.body);
        return saved.success
          ? { kind: "saved", openedParts: saved.data.openedParts }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
