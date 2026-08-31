import type { MaterialPreview } from "@/entities/material";

export type LibraryDiscoveryKind = "related" | "series" | "topic";

export interface LibraryDiscoveryReference {
  readonly name: string;
  readonly slug: string;
}

export type LibraryDiscoveryResult =
  | {
      readonly discoveryKind: LibraryDiscoveryKind;
      readonly hasNext: boolean;
      readonly items: readonly MaterialPreview[];
      readonly kind: "ready";
      readonly reference: LibraryDiscoveryReference;
    }
  | {
      readonly discoveryKind: LibraryDiscoveryKind;
      readonly kind: "empty";
      readonly reference: LibraryDiscoveryReference;
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };
