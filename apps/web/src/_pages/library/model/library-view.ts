import type { MaterialPreview } from "@/entities/material";

export type { MaterialPreview as LibraryMaterialPreview } from "@/entities/material";

export type LibraryCatalogResult =
  | {
      readonly kind: "ready";
      readonly firstHref: "/library" | null;
      readonly items: readonly MaterialPreview[];
      readonly nextHref: `/library?after=${string}` | null;
    }
  | { readonly kind: "empty"; readonly firstHref: "/library" | null }
  | { readonly kind: "unavailable" };
