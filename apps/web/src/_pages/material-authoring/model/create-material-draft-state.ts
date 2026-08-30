import type { JSONContent } from "@tiptap/core";

import type {
  MaterialPreviewPresentation,
  MaterialValidationIssue,
  MaterialValidationState,
} from "@/features/material-authoring";

export interface CreatedMaterialDraft {
  readonly access: "free" | "membership";
  readonly contentVersion: number;
  readonly document: JSONContent;
  readonly formatId: string | null;
  readonly materialId: string;
  readonly preview: MaterialPreviewPresentation;
  readonly seriesIds: readonly string[];
  readonly slug: string | null;
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string | null;
  readonly validation: Exclude<MaterialValidationState, { readonly kind: "checking" | "idle" }>;
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
