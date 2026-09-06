import type { ContentCover, MaterialPreview } from "@/entities/material";

export interface HomeCollection {
  readonly count: number;
  readonly cover: ContentCover | null;
  readonly id: string;
  readonly name: string;
  readonly previewItems: readonly MaterialPreview[];
  readonly slug: string;
  readonly summary: string | null;
}

export interface HomeView {
  readonly guides: readonly MaterialPreview[];
  readonly notes: readonly MaterialPreview[];
  readonly playlists: readonly HomeCollection[];
  readonly topics: readonly HomeCollection[];
  readonly videos: readonly MaterialPreview[];
  readonly membership:
    | Readonly<{ kind: "active" }>
    | Readonly<{ acquisitionUrl: string; kind: "inactive" }>
    | Readonly<{ kind: "unknown" }>;
}

export type HomeResult =
  | { readonly kind: "ready"; readonly value: HomeView }
  | { readonly kind: "unavailable" };
