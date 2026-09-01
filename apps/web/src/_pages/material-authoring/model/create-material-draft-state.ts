import type { MaterialValidationIssue } from "@/widgets/material-authoring/model";

export interface CreatedMaterialDraft {
  readonly contentVersion: number;
  readonly materialId: string;
}

export type CreateMaterialDraftActionState =
  | { readonly kind: "idle" }
  | {
      readonly issues: readonly MaterialValidationIssue[];
      readonly kind: "invalid_input";
    }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "forbidden" }
  | {
      readonly reference: string;
      readonly kind: "unexpected_error";
    }
  | {
      readonly draft: CreatedMaterialDraft;
      readonly kind: "created";
    };

export const initialCreateMaterialDraftState = {
  kind: "idle",
} as const satisfies CreateMaterialDraftActionState;
