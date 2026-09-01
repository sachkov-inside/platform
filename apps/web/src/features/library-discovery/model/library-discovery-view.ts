import type { MaterialPreview } from "@/entities/material";

export type LibraryDiscoveryKind = "related" | "series" | "topic";

export interface LibraryDiscoveryReference {
  readonly name: string;
  readonly slug: string;
}

export type LibraryDiscoveryResult<
  DiscoveryKind extends LibraryDiscoveryKind = LibraryDiscoveryKind,
> =
  | {
      readonly discoveryKind: DiscoveryKind;
      readonly hasNext: boolean;
      readonly items: readonly MaterialPreview[];
      readonly kind: "ready";
      readonly reference: LibraryDiscoveryReference;
    }
  | {
      readonly discoveryKind: DiscoveryKind;
      readonly kind: "empty";
      readonly reference: LibraryDiscoveryReference;
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

export type PublishedTopicResult = LibraryDiscoveryResult<"topic">;
export type PublishedSeriesResult = LibraryDiscoveryResult<"series">;
export type RelatedMaterialsResult = LibraryDiscoveryResult<"related">;
