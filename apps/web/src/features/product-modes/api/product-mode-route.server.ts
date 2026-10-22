import "server-only";

import { requestSetReaderProductMode } from "@/shared/api/backend/index.server";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { saveReaderProductModeOperation } from "./product-mode.operation";

/** Сохраняет режим вошедшего читателя. Гость держит своё значение в cookie и сюда не приходит. */
export function handleSetReaderProductMode(request: Request) {
  return handleMutationOperation(request, saveReaderProductModeOperation, {
    invalidInput: () => ({ kind: "invalid_input" }),
    execute: async (input, token) => {
      try {
        const result = await requestSetReaderProductMode(
          input.productMode,
          token,
        );
        if (!result.ok) {
          return {
            kind:
              result.response.status === 401 ? "unauthorized" : "unavailable",
          };
        }
        return { kind: "saved" };
      } catch {
        return { kind: "unavailable" };
      }
    },
  });
}
