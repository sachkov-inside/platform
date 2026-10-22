import { defineMutationOperation } from "@/shared/api/mutation-operation";

import {
  createMaterialDraftInputSchema,
  createMaterialDraftResultSchema,
  type CreateMaterialDraftResult,
} from "../model/create-material-draft";

/** Creates the first draft of a new Material. */
export const createMaterialDraftOperation = defineMutationOperation({
  input: createMaterialDraftInputSchema,
  method: "POST",
  path: "/api/authoring/materials",
  result: createMaterialDraftResultSchema,
  transportFailure: (failure): CreateMaterialDraftResult =>
    failure.kind === "contract"
      ? {
          kind: "unexpected_error",
          reference: "create-material-draft-bff-contract",
        }
      : failure.status === 401 || failure.status === 403
        ? { kind: "unauthorized" }
        : {
            kind: "unexpected_error",
            reference: `create-material-draft-bff-${String(failure.status)}`,
          },
});
