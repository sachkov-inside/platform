"use client";

import { useRouter } from "next/navigation";

import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import {
  SeriesOrderManager,
  type SeriesOrderPresentation,
} from "@/features/series-order";

export function SeriesOrderPageClient({
  presentation,
}: {
  readonly presentation: SeriesOrderPresentation;
}) {
  const router = useRouter();
  return (
    <SeriesOrderManager
      onBack={() => { router.push(authoringMaterialsRootHref); }}
      onRefresh={() => { router.refresh(); }}
      onSelectPlaylist={(seriesId) => { router.push(`/authoring/playlists/${seriesId}`); }}
      presentation={presentation}
    />
  );
}
