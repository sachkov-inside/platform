import type { ProductChapterTask } from "@/entities/product-task.model";
import type { ProductLandingPage } from "@/entities/product-page";
import type { ContentCover, MaterialPreview } from "@/entities/material";

export type LibraryDiscoveryKind = "related" | "series" | "topic";

/**
 * Author-written fields that tell a reader who a Product is for, what they will be
 * able to do, what they must know beforehand, and what stays outside it. Only a
 * Product has one.
 */
export interface ProductIntroduction {
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
  readonly introduction?: ProductIntroduction | null | undefined;
  readonly name: string;
  /** Оформление и описание страницы Product; у темы и связанных материалов его нет. */
  readonly productPage?: ProductLandingPage | null | undefined;
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

export interface ProductChapter {
  readonly id: string;
  readonly materialIds: readonly string[];
  readonly name: string;
  /** Авторское описание главы: на странице продукта оно объясняет, что внутри. */
  readonly summary: string;
  /**
   * Задания главы в авторском порядке (#947): каждое стоит после названного материала или в
   * начале главы. Глава без заданий может поле опустить.
   */
  readonly tasks?: readonly ProductChapterTask[];
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
      readonly chapters: readonly ProductChapter[];
      readonly discoveryKind: DiscoveryKind;
      readonly hasNext: boolean;
      readonly items: readonly MaterialPreview[];
      readonly kind: "ready";
      readonly reference: LibraryDiscoveryReference;
      readonly relatedSeries: readonly RelatedPlaylist[];
      readonly topics: readonly DiscoveryTopic[];
    }
  | {
      readonly chapters: readonly ProductChapter[];
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

/**
 * Открыт ли продукт этому Account по его основаниям: покупке, тарифу с продуктом или тарифу «все
 * продукты». Ответ не зависит от того, опубликованы ли платные уроки. `unknown` — ответа нет:
 * страница не прячет оплату, а повторную покупку остановит страница оплаты.
 */
export type ProductAccess = "open" | "closed" | "unknown";
