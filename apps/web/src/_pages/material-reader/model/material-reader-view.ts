export type ReaderMark =
  | { readonly kind: "bold" | "code" | "italic" | "strike" }
  | { readonly kind: "link"; readonly href: string };

export interface ReaderText {
  readonly kind: "text";
  readonly text: string;
  readonly marks: readonly ReaderMark[];
}

export type ReaderBlock =
  | { readonly kind: "paragraph"; readonly content: readonly ReaderText[] }
  | {
      readonly kind: "heading";
      readonly level: 2 | 3 | 4;
      readonly content: readonly ReaderText[];
    }
  | {
      readonly kind: "bullet_list" | "ordered_list";
      readonly items: readonly (readonly ReaderBlock[])[];
    }
  | { readonly kind: "blockquote"; readonly content: readonly ReaderBlock[] }
  | { readonly kind: "code_block"; readonly text: string }
  | { readonly kind: "horizontal_rule" }
  | {
      readonly kind: "table";
      readonly rows: readonly {
        readonly cells: readonly {
          readonly header: boolean;
          readonly content: readonly ReaderBlock[];
        }[];
      }[];
    }
  | {
      readonly kind: "callout";
      readonly tone: "note" | "tip" | "warning";
      readonly content: readonly ReaderBlock[];
    }
  | {
      readonly kind: "image";
      readonly assetId: string;
      readonly alt: string;
      readonly caption?: string | undefined;
    }
  | { readonly kind: "file"; readonly assetId: string; readonly label: string }
  | {
      readonly kind: "video";
      readonly videoId: string;
      readonly caption?: string | undefined;
    };

export interface MaterialReaderMetadata {
  readonly access: "free" | "membership";
  readonly format: { readonly name: string; readonly slug: string };
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

export type MaterialReaderResult =
  | {
      readonly kind: "available";
      readonly material: MaterialReaderMetadata;
      readonly body: readonly ReaderBlock[];
    }
  | {
      readonly kind: "access";
      readonly material: MaterialReaderMetadata;
      readonly reason: "forbidden" | "membership_required" | "temporarily_unavailable";
    }
  | { readonly kind: "not-found" };
