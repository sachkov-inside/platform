import type { JSONContent } from "@tiptap/core";

export type MaterialSaveState =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty" }
  | { readonly kind: "submitting" }
  | { readonly kind: "saved"; readonly savedAtLabel: string };

export interface MaterialValidationIssue {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly targetId: string;
}

export type MaterialValidationState =
  | { readonly kind: "unchecked" }
  | { readonly kind: "checking" }
  | { readonly kind: "valid"; readonly checkedAtLabel: string }
  | {
      readonly kind: "invalid";
      readonly issues: readonly MaterialValidationIssue[];
    }
  | {
      readonly correlationId: string;
      readonly kind: "failed";
      readonly message: string;
    };

export interface MaterialDraftPresentation {
  readonly access: "free" | "membership";
  readonly document: JSONContent;
  readonly format: string;
  readonly materialId: string | null;
  readonly revisionId: string | null;
  readonly slug: string;
  readonly status: "draft" | "new";
  readonly summary: string;
  readonly tags: string;
  readonly title: string;
  readonly topic: string;
}

export type MaterialPreviewMark =
  | { readonly kind: "bold" | "code" | "italic" | "strike" }
  | { readonly href: string; readonly kind: "link" };

export interface MaterialPreviewText {
  readonly kind: "text";
  readonly marks: readonly MaterialPreviewMark[];
  readonly text: string;
}

export type MaterialPreviewBlock =
  | {
      readonly content: readonly MaterialPreviewText[];
      readonly kind: "paragraph";
    }
  | {
      readonly content: readonly MaterialPreviewText[];
      readonly kind: "heading";
      readonly level: 2 | 3 | 4;
    }
  | {
      readonly items: readonly (readonly MaterialPreviewBlock[])[];
      readonly kind: "bullet_list" | "ordered_list";
    }
  | {
      readonly content: readonly MaterialPreviewBlock[];
      readonly kind: "blockquote";
    }
  | { readonly kind: "code_block"; readonly text: string }
  | { readonly kind: "horizontal_rule" }
  | {
      readonly content: readonly MaterialPreviewBlock[];
      readonly kind: "callout";
      readonly tone: "note" | "tip" | "warning";
    };

export interface MaterialPreviewPresentation {
  readonly accessLabel: string;
  readonly blocks: readonly MaterialPreviewBlock[];
  readonly exactRevisionId: string;
  readonly format: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly topic: string;
}

export type MaterialWorkspaceBlockingState =
  | { readonly kind: "none" }
  | {
      readonly currentRevisionId: string;
      readonly kind: "conflict";
      readonly staleRevisionId: string;
    }
  | {
      readonly correlationId: string;
      readonly kind: "infrastructure_error";
    };

export interface MaterialAuthoringPresentation {
  readonly authorization:
    | { readonly kind: "allowed" }
    | { readonly kind: "unauthorized" };
  readonly blocking: MaterialWorkspaceBlockingState;
  readonly draft: MaterialDraftPresentation;
  readonly mode: "editor" | "preview";
  readonly preview: MaterialPreviewPresentation | null;
  readonly save: MaterialSaveState;
  readonly validation: MaterialValidationState;
}

export type MaterialDraftField =
  | "access"
  | "format"
  | "slug"
  | "summary"
  | "tags"
  | "title"
  | "topic";

export interface MaterialAuthoringActions {
  readonly onBack: () => void;
  readonly onConflictAction: (action: "compare" | "copy" | "reload") => void;
  readonly onDocumentChange: (document: JSONContent) => void;
  readonly onFieldChange: (field: MaterialDraftField, value: string) => void;
  readonly onOpenPreview: () => void;
  readonly onRetry: () => void;
  readonly onReturnToEditor: () => void;
  readonly onSave: () => void;
  readonly onValidate: () => void;
}
