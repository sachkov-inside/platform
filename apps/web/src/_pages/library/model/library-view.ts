import type { MaterialPreview } from "@/entities/material";

export type { MaterialPreview as LibraryMaterialPreview } from "@/entities/material";

export type LibraryCatalogPage =
  | {
      readonly kind: "ready";
      readonly items: readonly MaterialPreview[];
      readonly nextCursor: string | null;
    }
  | { readonly kind: "empty" }
  | { readonly kind: "unavailable" };
