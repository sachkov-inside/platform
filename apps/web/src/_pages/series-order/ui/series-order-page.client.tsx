"use client";

import { useRouter } from "next/navigation";

import { authoringMaterialsRootHref } from "@/features/material-authoring";
import {
  SeriesOrderManager,
  type SeriesOrderMutation,
  type SeriesOrderPresentation,
} from "@/features/series-order";

export function SeriesOrderPageClient({
  action,
  presentation,
}: {
  readonly action: SeriesOrderMutation;
  readonly presentation: SeriesOrderPresentation;
}) {
  const router = useRouter();
  return (
    <SeriesOrderManager
      action={action}
      onBack={() => { router.push(authoringMaterialsRootHref); }}
      onRefresh={() => { router.refresh(); }}
      onSelectPlaylist={(seriesId) => { router.push(`/authoring/playlists/${seriesId}`); }}
      presentation={presentation}
    />
  );
}
