import { SavedReadingAction, VisibleMaterialOpen } from "@/features/reading-progress";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { notFound } from "next/navigation";

import { loadPublishedSeries } from "@/features/library-discovery.server";
import { loadMaterialReader } from "../api/load-material-reader";
import { resolveSeriesReaderContext } from "../model/series-reader-context";
import {
  libraryMaterialReaderReturnTarget,
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { MaterialReaderAccess, MaterialReaderUnavailable } from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

export async function MaterialReaderPage({
  accessToken,
  returnTarget,
  slug,
}: {
  readonly accessToken?: string;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly slug: string;
}) {
  const [result, seriesResult] = await Promise.all([
    loadMaterialReader(slug, accessToken),
    returnTarget.kind === "series" && returnTarget.seriesSlug !== undefined
      ? loadPublishedSeries(returnTarget.seriesSlug, accessToken)
      : Promise.resolve(null),
  ]);
  if (result.kind === "not-found") {
    notFound();
  }
  const seriesContext =
    seriesResult?.kind === "ready" &&
    (result.kind === "available" || result.kind === "access")
      ? resolveSeriesReaderContext({
          currentMaterialSlug: result.material.slug,
          returnTarget,
          series: seriesResult,
        })
      : null;
  const effectiveReturnTarget =
    returnTarget.kind === "series" && seriesContext === null
      ? libraryMaterialReaderReturnTarget
      : returnTarget;
  if (result.kind === "access") {
    return (
      <div className="@container/material-reader">
        <MaterialReaderAccess
          readingAction={<SavedReadingAction key={result.material.materialId} materialId={result.material.materialId} format={result.material.format.slug} canMark={false} />}
          cta={result.cta}
          material={result.material}
          returnTarget={effectiveReturnTarget}
          seriesContext={seriesContext}
        />
      </div>
    );
  }
  if (result.kind === "unavailable") {
    return (
      <MaterialReaderUnavailable
        retryHref={currentMaterialHref(slug, effectiveReturnTarget)}
        returnTarget={effectiveReturnTarget}
      />
    );
  }
  return (
    <VisibleMaterialOpen key={`${result.material.materialId}:${String(result.material.contentVersion)}`} materialId={result.material.materialId} contentVersion={result.material.contentVersion}>
    <MaterialReaderView
      readingAction={<SavedReadingAction key={result.material.materialId} materialId={result.material.materialId} format={result.material.format.slug} />}
      bookmarkAction={<SavedBookmarkAction materialId={result.material.materialId} signedIn={accessToken !== undefined} />}
      body={result.body}
      material={result.material}
      primaryVideo={result.primaryVideo}
      returnTarget={effectiveReturnTarget}
      seriesContext={seriesContext}
    />
    </VisibleMaterialOpen>
  );
}

function currentMaterialHref(
  slug: string,
  returnTarget: MaterialReaderReturnTarget,
) {
  return materialReaderHref(
    slug,
    returnTarget.kind === "library" ? undefined : returnTarget.href,
  );
}
