import type { CreateMaterialDraftActionState } from "./create-material-draft-state";
import type { SaveMaterialActionState } from "./save-material-state";

export type MaterialAuthoringActionState =
  | CreateMaterialDraftActionState
  | SaveMaterialActionState;

export const initialMaterialAuthoringActionState = {
  kind: "idle",
} as const satisfies MaterialAuthoringActionState;
