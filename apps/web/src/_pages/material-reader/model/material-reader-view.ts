import type { RenderedBlock, RenderedMark, RenderedText } from "@/entities/material";

export type ReaderMark = RenderedMark;
export type ReaderText = RenderedText;
export type ReaderBlock = RenderedBlock;

export interface MaterialReaderMetadata {
  readonly access: "free" | "membership" | "workshop";
  readonly contentVersion: number;
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
      readonly cta: {
        readonly label: "Получить доступ";
        readonly url: string;
      };
    }
  | { readonly kind: "unavailable" }
  | { readonly kind: "not-found" };
