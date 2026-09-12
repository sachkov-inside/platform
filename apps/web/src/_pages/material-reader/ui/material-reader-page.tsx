import { SavedReadingAction, VisibleMaterialOpen } from "@/features/reading-progress";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { notFound } from "next/navigation";

import { loadGuideOffers } from "@/entities/subscription.catalog.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { loadMaterialReader } from "../api/load-material-reader";
import { resolveSeriesReaderContext } from "../model/series-reader-context";
import {
  libraryMaterialReaderReturnTarget,
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { purchaseInvitation } from "@/shared/routing/subscription-route";
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
    // Руководство, которым человек занят, важнее тарифов: если у него есть своя цена, дальше
    // идёт его оплата. Иначе человек попадает на витрину и возвращается к этому же материалу.
    const guideSlug =
      returnTarget.kind === "series"
        ? returnTarget.seriesSlug
        : result.material.seriesMemberships[0]?.series.slug;
    const invitation = purchaseInvitation({
      ...(guideSlug === undefined
        ? {}
        : { guide: { slug: guideSlug, sold: await guideIsSold(guideSlug, accessToken) } }),
      from: currentMaterialHref(slug, effectiveReturnTarget),
      subscriptionOffered: result.subscriptionOffered,
    });
    return (
      <div className="@container/material-reader">
        <MaterialReaderAccess
          readingAction={<SavedReadingAction key={result.material.materialId} materialId={result.material.materialId} format={result.material.format.slug} canMark={false} />}
          invitation={invitation}
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
      bookmarkAction={<SavedBookmarkAction materialId={result.material.materialId} />}
      body={result.body}
      material={result.material}
      primaryVideo={result.primaryVideo}
      returnTarget={effectiveReturnTarget}
      seriesContext={seriesContext}
    />
    </VisibleMaterialOpen>
  );
}

/** Руководство продаётся, только когда владелец завёл ему цену; сбой каталога её не выдумывает. */
async function guideIsSold(slug: string, accessToken?: string): Promise<boolean> {
  const guide = await loadPublishedSeries(slug, accessToken);
  const guideId =
    guide.kind === "ready" || guide.kind === "empty" ? guide.reference.id : undefined;
  if (guideId === undefined) return false;
  const offers = await loadGuideOffers(guideId);
  return offers.kind === "ready" && offers.offers.length > 0;
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
