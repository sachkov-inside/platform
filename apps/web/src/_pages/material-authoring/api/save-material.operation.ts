import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  saveMaterialInputSchema,
  saveMaterialResultSchema,
  type SaveMaterialResult,
} from "../model/save-material";

/** Saves the full editor state of an existing Material. */
export const saveMaterialOperation = defineMutationOperation({
  input: saveMaterialInputSchema,
  method: "PUT",
  path: "/api/authoring/materials",
  result: saveMaterialResultSchema,
  transportFailure: (failure): SaveMaterialResult =>
    failure.kind === "contract"
      ? {
          kind: "infrastructure_error",
          reference: "save-material-bff-contract",
        }
      : failure.status === 401 || failure.status === 403
        ? { kind: "unauthorized" }
        : {
            kind: "infrastructure_error",
            reference: `save-material-bff-${String(failure.status)}`,
          },
});
