"use client";

import { useRouter } from "next/navigation";

import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import {
  SeriesOrderManager,
  type SeriesOrderPresentation,
} from "@/features/series-order";

import { searchSeriesOrderMaterials } from "../api/search-series-order-materials.browser";

export function SeriesOrderPageClient({
  presentation,
}: {
  readonly presentation: SeriesOrderPresentation;
}) {
  const router = useRouter();
  return (
    <SeriesOrderManager
      loadMaterials={searchSeriesOrderMaterials}
      onBack={() => { router.push(authoringMaterialsRootHref); }}
      onRefresh={() => { router.refresh(); }}
      onSelectPlaylist={(seriesId) => { router.push(`/authoring/playlists/${seriesId}`); }}
      presentation={presentation}
    />
  );
}
