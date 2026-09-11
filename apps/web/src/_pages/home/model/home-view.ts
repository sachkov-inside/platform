import type { ContentCover, MaterialPreview } from "@/entities/material";

/** Ready presentation for continuation inside the existing Home sections. */
export interface HomeContinuation {
  readonly video?: { readonly material: MaterialPreview; readonly label: string } | undefined;
  readonly series?: { readonly collection: HomeCollection; readonly read: number; readonly total: number } | undefined;
}

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
  readonly pinnedSeries: HomeCollection | null;
  readonly membership:
    | { readonly kind: "active" }
    | { readonly kind: "inactive"; readonly acquisitionUrl: string }
    | { readonly kind: "notOffered" }
    | { readonly kind: "unknown" };
  readonly guides: readonly MaterialPreview[];
  readonly notes: readonly MaterialPreview[];
  readonly playlists: readonly HomeCollection[];
  readonly topics: readonly HomeCollection[];
  readonly videos: readonly MaterialPreview[];
}

export type HomeResult =
  | { readonly kind: "ready"; readonly value: HomeView }
  | { readonly kind: "unavailable" };
