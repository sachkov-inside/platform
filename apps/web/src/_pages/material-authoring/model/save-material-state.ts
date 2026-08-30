import type {
  MaterialValidationIssue,
  MaterialValidationState,
} from "@/features/material-authoring";

export type SaveMaterialActionState =
  | { readonly kind: "idle" }
  | {
      readonly issues: readonly MaterialValidationIssue[];
      readonly kind: "invalid_input";
    }
  | { readonly kind: "unauthorized" | "forbidden" | "not_found" }
  | {
      readonly currentContentVersion: number;
      readonly kind: "conflict";
      readonly staleContentVersion: number;
    }
  | {
      readonly kind: "infrastructure_error";
      readonly reference: string;
    }
  | {
      readonly contentVersion: number;
      readonly kind: "saved";
      readonly nextSubmissionId: string;
      readonly publicationState: "draft" | "published" | "unpublished";
      readonly validation: Exclude<
        MaterialValidationState,
        { readonly kind: "checking" | "idle" }
      >;
    };

export const initialSaveMaterialState = {
  kind: "idle",
} as const satisfies SaveMaterialActionState;
