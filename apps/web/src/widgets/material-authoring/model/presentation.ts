import type { JSONContent } from "@tiptap/core";

import type { RenderedBlock, RenderedMark, RenderedText } from "@/entities/material";
import type {
  DeleteMaterialDraftInput,
  DeleteMaterialDraftResult,
} from "@/features/material-lifecycle";

export type MaterialSaveState =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty" }
  | { readonly kind: "submitting" }
  | { readonly kind: "saved"; readonly savedAtLabel: string };

export interface MaterialSelectOption {
  readonly label: string;
  readonly value: string;
}

export interface MaterialDraftPresentation {
  readonly access: "free" | "membership";
  readonly canDelete: boolean;
  readonly document: JSONContent;
  readonly formatId: string;
  readonly materialId: string | null;
  readonly contentVersion: number | null;
  readonly readOnly: boolean;
  readonly seriesIds: readonly string[];
  readonly status: "draft" | "new" | "published" | "unpublished";
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string;
}

export type MaterialPreviewMark = RenderedMark;
export type MaterialPreviewText = RenderedText;
export type MaterialPreviewBlock = RenderedBlock;

export interface MaterialPreviewPresentation {
  readonly accessLabel: string;
  readonly blocks: readonly MaterialPreviewBlock[];
  readonly contentVersion: number;
  readonly format: string;
  readonly materialId: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly topic: string;
  readonly publicationState: "draft" | "published" | "unpublished";
}

export interface MaterialValidationIssue {
  readonly message: string;
  readonly path: string;
}

export type MaterialValidationState =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | {
      readonly issues: readonly MaterialValidationIssue[];
      readonly kind: "invalid";
      readonly scope: "input" | "publication";
    }
  | {
      readonly headingCount: number;
      readonly kind: "valid";
      readonly plainTextLength: number;
    };

export type MaterialWorkspaceBlockingState =
  | { readonly kind: "none" }
  | { readonly kind: "not_found" }
  | {
      readonly currentContentVersion: number;
      readonly kind: "conflict";
      readonly staleContentVersion: number;
    }
  | {
      readonly correlationId: string;
      readonly kind: "infrastructure_error";
    };

export interface MaterialAuthoringPresentation {
  readonly availableFormats: readonly MaterialSelectOption[];
  readonly availableSeries: readonly MaterialSelectOption[];
  readonly availableTags: readonly MaterialSelectOption[];
  readonly availableTopics: readonly MaterialSelectOption[];
  readonly authorization:
    | { readonly kind: "allowed" }
    | { readonly kind: "unauthorized" };
  readonly blocking: MaterialWorkspaceBlockingState;
  readonly deletion: {
    readonly pending: boolean;
    readonly result: DeleteMaterialDraftResult | null;
  };
  readonly draft: MaterialDraftPresentation;
  readonly mode: "editor" | "preview";
  readonly noticeRevision: number;
  readonly preview: MaterialPreviewPresentation | null;
  readonly save: MaterialSaveState;
  readonly submissionId: string;
  readonly validation: MaterialValidationState;
}

export type MaterialDraftField =
  | "access"
  | "formatId"
  | "summary"
  | "title"
  | "topicId";

export interface MaterialAuthoringActions {
  readonly onBack: () => void;
  readonly onConflictAction: (action: "compare" | "copy" | "open_current") => void;
  readonly onDocumentChange: (document: JSONContent) => void;
  readonly onDelete: (input: DeleteMaterialDraftInput) => void;
  readonly onFieldChange: (field: MaterialDraftField, value: string) => void;
  readonly onOpenPreview: () => void;
  readonly onRetry: () => void;
  readonly onReturnToEditor: () => void;
  readonly onSave: (
    publicationState: "draft" | "published" | "unpublished",
  ) => void;
  readonly onSeriesToggle: (seriesId: string, checked: boolean) => void;
  readonly onTagToggle: (tagId: string, checked: boolean) => void;
}
