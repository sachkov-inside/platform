import type { JSONContent } from "@tiptap/core";

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
  readonly document: JSONContent;
  readonly format: string;
  readonly materialId: string | null;
  readonly contentVersion: number | null;
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
  readonly contentVersion: number;
  readonly format: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly title: string;
  readonly topic: string;
}

export type MaterialWorkspaceBlockingState =
  | { readonly kind: "none" }
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
  readonly availableTopics: readonly MaterialSelectOption[];
  readonly authorization:
    | { readonly kind: "allowed" }
    | { readonly kind: "unauthorized" };
  readonly blocking: MaterialWorkspaceBlockingState;
  readonly draft: MaterialDraftPresentation;
  readonly mode: "editor" | "preview";
  readonly preview: MaterialPreviewPresentation | null;
  readonly save: MaterialSaveState;
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
}
