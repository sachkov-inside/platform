import "server-only";
import { z } from "zod";
import { requestRecordMaterialOpen } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";
import { recordMaterialOpenOperation } from "./reading-progress.operation";
export function handleMaterialOpen(request: Request) {
  return handleMutationOperation(request, recordMaterialOpenOperation, {
    invalidInput: () => ({ kind: "invalid_input" }) as const,
    execute: async (input, token) => {
      try {
        const response = await requestRecordMaterialOpen(input, token);
        if (!response.ok)
          return {
            kind:
              response.response.status === 401
                ? "unauthorized"
                : response.response.status === 403
                  ? "denied"
                  : response.response.status === 409
                    ? "conflict"
                    : "unavailable",
          };
        const result = z
          .object({ openedAt: z.iso.datetime(), replayed: z.boolean() })
          .strict()
          .safeParse(response.body);
        return result.success
          ? { kind: "saved", ...result.data }
          : { kind: "unavailable" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
