import type { ContentCover, MaterialPreview } from "@/entities/material";

export type { MaterialPreview as LibraryMaterialPreview } from "@/entities/material";

export interface LibraryCatalogFacet {
  readonly count: number;
  readonly cover?: ContentCover | null | undefined;
  readonly id: string;
  readonly name: string;
  readonly previewItems?: readonly MaterialPreview[] | undefined;
  readonly slug: string;
  readonly summary: string | null;
}

export type LibraryCatalogPage =
  | {
      readonly facets: {
        readonly formats: readonly LibraryCatalogFacet[];
        readonly series: readonly LibraryCatalogFacet[];
        readonly topics: readonly LibraryCatalogFacet[];
      };
      readonly kind: "ready";
      readonly items: readonly MaterialPreview[];
      readonly nextCursor: string | null;
      readonly totalCount: number;
    }
  | { readonly kind: "empty" }
  | { readonly kind: "unavailable" };
