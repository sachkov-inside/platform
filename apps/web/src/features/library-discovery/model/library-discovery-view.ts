import type { MaterialPreview } from "@/entities/material";

export type LibraryDiscoveryKind = "related" | "series" | "topic";

export interface LibraryDiscoveryReference {
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
}

export interface RelatedPlaylist {
  readonly id: string;
  readonly matchingMaterialCount: number;
  readonly name: string;
  readonly slug: string;
  readonly summary: string;
  readonly totalMaterialCount: number;
}

export interface DiscoveryTopic {
  readonly id: string;
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
      readonly relatedSeries: readonly RelatedPlaylist[];
      readonly topics: readonly DiscoveryTopic[];
    }
  | {
      readonly discoveryKind: DiscoveryKind;
      readonly kind: "empty";
      readonly reference: LibraryDiscoveryReference;
      readonly relatedSeries: readonly RelatedPlaylist[];
      readonly topics: readonly DiscoveryTopic[];
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

export type PublishedTopicResult = LibraryDiscoveryResult<"topic">;
export type PublishedSeriesResult = LibraryDiscoveryResult<"series">;
export type RelatedMaterialsResult = LibraryDiscoveryResult<"related">;
