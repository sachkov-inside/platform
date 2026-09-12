import type {
  ContentCover,
  RenderedBlock,
  RenderedMark,
  RenderedText,
} from "@/entities/material.model";
import type { MaterialDifficulty } from "@/shared/api/material-lesson-facts";

export type ReaderMark = RenderedMark;
export type ReaderText = RenderedText;
export type ReaderBlock = RenderedBlock;

export interface MaterialReaderMetadata {
  readonly access: "free" | "membership" | "workshop";
  readonly contentVersion: number;
  readonly cover: ContentCover | null;
  /** Сложность урока и что он обещает; урок без этих значений просто их не показывает. */
  readonly difficulty: MaterialDifficulty | null;
  readonly outcomes: readonly string[];
  readonly format: { readonly name: string; readonly slug: string };
  readonly materialId: string;
  readonly publishedAt: string;
  readonly seriesMemberships: readonly {
    readonly ordinal: number;
    readonly series: { readonly name: string; readonly slug: string };
  }[];
  readonly slug: string;
  readonly summary: string;
  readonly tags: readonly { readonly name: string }[];
  readonly title: string;
  readonly topic: { readonly name: string; readonly slug: string };
}

export interface PrimaryVideoPresentation {
  readonly durationSeconds?: number | undefined;
  readonly failureCode?: string | undefined;
  readonly state: "uploading" | "processing" | "ready" | "failed";
  readonly title: string;
  readonly videoId: string;
}

export type MaterialReaderResult =
  | {
      readonly kind: "available";
      readonly material: MaterialReaderMetadata;
      readonly body: readonly ReaderBlock[];
      readonly primaryVideo: PrimaryVideoPresentation | null;
    }
  | {
      readonly kind: "access";
      readonly material: MaterialReaderMetadata;
      /**
       * Продаётся ли сейчас подписка. Куда ведёт призыв к покупке, решает страница:
       * у руководства со своей ценой это его оплата, иначе — витрина подписки.
       */
      readonly subscriptionOffered: boolean;
    }
  | { readonly kind: "unavailable" }
  | { readonly kind: "not-found" };
