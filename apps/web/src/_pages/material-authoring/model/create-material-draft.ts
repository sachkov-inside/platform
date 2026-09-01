import type { JSONContent } from "@tiptap/core";

import type { MaterialValidationIssue } from "@/widgets/material-authoring/model";

export interface CreateMaterialDraftInput {
  readonly access: "free" | "membership";
  readonly document: JSONContent;
  readonly formatId: string;
  readonly seriesIds: readonly string[];
  readonly submissionId: string;
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string;
}

export interface CreatedMaterialDraft {
  readonly contentVersion: number;
  readonly materialId: string;
}

export type CreateMaterialDraftResult =
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
