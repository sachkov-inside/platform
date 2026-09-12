import type { ContentCover, MaterialPreview } from "@/entities/material";

export type LibraryDiscoveryKind = "related" | "series" | "topic";

/**
 * Author-written fields that tell a reader who a Guide is for, what they will be
 * able to do, what they must know beforehand, and what stays outside it. Only a
 * Guide has one.
 */
export interface GuideIntroduction {
  readonly audience: string;
  readonly outcome: string;
  readonly prerequisites: string;
  readonly scope: string;
}

export interface LibraryDiscoveryReference {
  readonly id?: string | undefined;
  readonly cover?: ContentCover | null | undefined;
  /**
   * Есть ли в руководстве хоть один шаг, написанный для обоих режимов прохождения. Переключатель
   * принадлежит руководству, поэтому урок берёт этот признак из состава, а не из своего тела.
   */
  readonly hasModeVariants?: boolean | undefined;
  readonly introduction?: GuideIntroduction | null | undefined;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
}

export interface RelatedPlaylist {
  readonly cover?: ContentCover | null | undefined;
  readonly id: string;
  readonly matchingMaterialCount: number;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly totalMaterialCount: number;
}

export interface GuideChapter {
  readonly id: string;
  readonly materialIds: readonly string[];
  readonly name: string;
  /** Авторское описание главы: на странице продукта оно объясняет, что внутри. */
  readonly summary: string;
}

export interface DiscoveryTopic {
  readonly cover?: ContentCover | null | undefined;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export type LibraryDiscoveryResult<
  DiscoveryKind extends LibraryDiscoveryKind = LibraryDiscoveryKind,
> =
  | {
      readonly chapters: readonly GuideChapter[];
      readonly discoveryKind: DiscoveryKind;
      readonly hasNext: boolean;
      readonly items: readonly MaterialPreview[];
      readonly kind: "ready";
      readonly reference: LibraryDiscoveryReference;
      readonly relatedSeries: readonly RelatedPlaylist[];
      readonly topics: readonly DiscoveryTopic[];
    }
  | {
      readonly chapters: readonly GuideChapter[];
      readonly discoveryKind: DiscoveryKind;
      readonly kind: "empty";
      readonly reference: LibraryDiscoveryReference;
      readonly relatedSeries: readonly RelatedPlaylist[];
      readonly topics: readonly DiscoveryTopic[];
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

export type PublishedTopicResult = LibraryDiscoveryResult<"topic">;
export type PublishedSeriesResult = LibraryDiscoveryResult<"series">;
export type RelatedMaterialsResult = LibraryDiscoveryResult<"related">;
