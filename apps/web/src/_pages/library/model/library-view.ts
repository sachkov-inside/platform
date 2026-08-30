import type { MaterialPreview } from "@/entities/material";

export type { MaterialPreview as LibraryMaterialPreview } from "@/entities/material";

export interface LibraryCatalogFacet {
  readonly count: number;
  readonly id: string;
  readonly name: string;
  readonly slug: string;
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
