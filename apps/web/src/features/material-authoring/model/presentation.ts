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

export interface MaterialSeriesMembershipPresentation {
  readonly ordinal: number;
  readonly seriesId: string;
}

export interface MaterialDraftPresentation {
  readonly access: "free" | "membership";
  readonly document: JSONContent;
  readonly formatId: string;
  readonly materialId: string | null;
  readonly contentVersion: number | null;
  readonly readOnly: boolean;
  readonly seriesMemberships: readonly MaterialSeriesMembershipPresentation[];
  readonly slug: string;
  readonly status: "draft" | "new" | "published" | "unpublished";
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string;
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
      readonly kind: "table";
      readonly rows: readonly {
        readonly cells: readonly {
          readonly header: boolean;
          readonly content: readonly MaterialPreviewBlock[];
        }[];
      }[];
    }
  | {
      readonly content: readonly MaterialPreviewBlock[];
      readonly kind: "callout";
      readonly tone: "note" | "tip" | "warning";
    }
  | {
      readonly alt: string;
      readonly assetId: string;
      readonly caption?: string | undefined;
      readonly kind: "image";
    }
  | { readonly assetId: string; readonly kind: "file"; readonly label: string }
  | {
      readonly caption?: string | undefined;
      readonly kind: "video";
      readonly videoId: string;
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
  | "publicationState"
  | "slug"
  | "summary"
  | "title"
  | "topicId";

export interface MaterialAuthoringActions {
  readonly onBack: () => void;
  readonly onConflictAction: (action: "compare" | "copy" | "open_current") => void;
  readonly onDocumentChange: (document: JSONContent) => void;
  readonly onFieldChange: (field: MaterialDraftField, value: string) => void;
  readonly onOpenPreview: () => void;
  readonly onRetry: () => void;
  readonly onReturnToEditor: () => void;
  readonly onSave: (formData: FormData) => void;
  readonly onSeriesMembershipChange: (
    seriesId: string,
    ordinal: number | null,
  ) => void;
  readonly onTagToggle: (tagId: string, checked: boolean) => void;
}
