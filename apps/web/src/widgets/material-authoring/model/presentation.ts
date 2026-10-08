import type { JSONContent } from "@tiptap/core";
import type { Route } from "next";

import type {
  ContentCover,
  RenderedBlock,
  RenderedMark,
  RenderedText,
} from "@/entities/material";
import type {
  DeleteMaterialDraftInput,
  DeleteMaterialDraftResult,
} from "@/features/material-lifecycle";
import type { MaterialAuthoringVideo } from "@/features/material-video";
import type { ProductRemoval } from "@/shared/lib/product-removal";

export type MaterialSaveState =
  | { readonly kind: "clean" }
  | { readonly kind: "dirty" }
  | { readonly kind: "submitting" }
  | { readonly kind: "saved"; readonly savedAtLabel: string };

export interface MaterialSelectOption {
  readonly archived?: boolean;
  readonly label: string;
  readonly value: string;
}

export interface MaterialDraftPresentation {
  readonly sourcePath?: string;
  readonly access: "free" | "closed";
  readonly canDelete: boolean;
  readonly cover?: ContentCover | null | undefined;
  readonly document: JSONContent;
  readonly assetPreviewBlocks?: readonly RenderedBlock[];
  readonly deleteVideoId: string | null;
  /** Видео, которые автор убрал после последнего сохранения; Save записывает это решение. */
  readonly detachVideoIds: readonly string[];
  /** Сложность урока; `unassigned`, пока автор её не выбрал. */
  readonly difficulty: string;
  readonly formatId: string;
  /** «Чему научишься»: до четырёх пунктов, публикация требует ноль либо два-четыре. */
  readonly outcomes: readonly string[];
  readonly materialId: string | null;
  readonly latestVideoDeletion: MaterialAuthoringVideo | null;
  readonly primaryVideo: MaterialAuthoringVideo | null;
  readonly primaryVideoId: string | null;
  readonly contentVersion: number | null;
  readonly readOnly: boolean;
  readonly seriesIds: readonly string[];
  readonly status: "draft" | "new" | "published" | "unpublished";
  readonly summary: string;
  readonly tagIds: readonly string[];
  readonly title: string;
  readonly topicId: string;
  readonly unselectedVideoUpload: MaterialAuthoringVideo | null;
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
  /**
   * Основное видео материала. Готовое видео предпросмотр показывает плеером и у черновика; когда
   * видео нет или оно не готово, состояние названо словами. Без поля о видео ничего не выводится.
   */
  readonly video?: MaterialPreviewVideo;
}

export type MaterialPreviewVideo =
  | { readonly kind: "none" }
  | {
      readonly durationSeconds?: number | undefined;
      readonly kind: "attached";
      readonly ready: boolean;
      readonly title: string;
      readonly videoId: string;
    }
  | { readonly kind: "unavailable" };

export interface MaterialPreviewRouteItem {
  readonly current: boolean;
  readonly href: Route;
  readonly publicationState: MaterialPreviewPresentation["publicationState"];
  readonly title: string;
}

export interface MaterialPreviewRouteSection {
  /** Идентификатор главы; у материалов вне глав его нет. */
  readonly chapterId: string | null;
  readonly items: readonly MaterialPreviewRouteItem[];
  /** Название главы либо «Вне глав»; у руководства без глав раздел один и безымянный. */
  readonly name: string | null;
}

/**
 * Место материала в руководстве глазами автора: черновики и снятые материалы входят в маршрут
 * наравне с опубликованными.
 */
export type MaterialPreviewRoutePresentation =
  | {
      readonly productName: string;
      readonly kind: "ready";
      readonly next: MaterialPreviewRouteItem | null;
      /** Другие руководства этого материала: переход открывает его в их маршруте. */
      readonly otherProducts: readonly {
        readonly href: Route;
        readonly name: string;
      }[];
      /** Номер материала в порядке показа, с единицы. */
      readonly position: number;
      readonly previous: MaterialPreviewRouteItem | null;
      readonly sections: readonly MaterialPreviewRouteSection[];
      readonly total: number;
    }
  | { readonly kind: "unavailable"; readonly reference: string };

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
  /**
   * Подпись возврата: к списку материалов или в редактор продукта, откуда открыт материал (#837).
   * Страница редактора задаёт её по адресу возврата; без неё возврат ведёт к списку материалов.
   */
  readonly backLabel?: string;
  readonly availableSeries: readonly MaterialSelectOption[];
  readonly availableTags: readonly MaterialSelectOption[];
  readonly availableTopics: readonly MaterialSelectOption[];
  readonly authorization:
    { readonly kind: "allowed" } | { readonly kind: "unauthorized" };
  readonly blocking: MaterialWorkspaceBlockingState;
  readonly deletion: {
    readonly pending: boolean;
    readonly result: DeleteMaterialDraftResult | null;
  };
  readonly draft: MaterialDraftPresentation;
  readonly noticeRevision: number;
  /** Снятие опубликованного материала из купленных продуктов ждёт подтверждения автора. */
  readonly removalConfirmation?: {
    readonly products: readonly ProductRemoval[];
    readonly pending: boolean;
  } | null;
  readonly save: MaterialSaveState;
  readonly submissionId: string;
  readonly validation: MaterialValidationState;
}

export type MaterialDraftField =
  "access" | "difficulty" | "formatId" | "summary" | "title" | "topicId";

export interface MaterialAuthoringActions {
  readonly onBack: () => void;
  /** Автор оставляет материал в купленных продуктах: снятие отменяется. */
  readonly onCancelProductRemoval: () => void;
  /** Автор подтверждает снятие материала из купленных продуктов. */
  readonly onConfirmProductRemoval: () => void;
  readonly onConflictAction: (
    action: "compare" | "copy" | "open_current",
  ) => void;
  readonly onDocumentChange: (document: JSONContent) => void;
  readonly onDelete: (input: DeleteMaterialDraftInput) => void;
  readonly onFieldChange: (field: MaterialDraftField, value: string) => void;
  readonly onOpenPreview: () => void;
  readonly onOutcomesChange: (outcomes: readonly string[]) => void;
  readonly onPrimaryVideoChange: (
    primaryVideo: MaterialAuthoringVideo | null,
    deleteVideoId: string | null,
    detachedVideoId: string | null,
  ) => void;
  readonly onRetry: () => void;
  readonly onReturnToEditor: () => void;
  readonly onSave: (
    publicationState: "draft" | "published" | "unpublished",
  ) => void;
  readonly onSeriesToggle: (seriesId: string, checked: boolean) => void;
  readonly onTagToggle: (tagId: string, checked: boolean) => void;
}
