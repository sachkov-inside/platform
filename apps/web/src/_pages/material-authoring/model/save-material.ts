import type { JSONContent } from "@tiptap/core";

import type { MaterialValidationIssue } from "@/widgets/material-authoring/model";

export interface SaveMaterialInput {
  readonly access: "free" | "membership";
  readonly document: JSONContent;
  readonly expectedContentVersion: number;
  readonly formatId: string;
  readonly materialId: string;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly seriesIds: readonly string[];
  readonly submissionId: string;
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string;
}

export type SaveMaterialResult =
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
    };
