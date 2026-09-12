import { SavedReadingAction, VisibleMaterialOpen } from "@/features/reading-progress";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { notFound } from "next/navigation";

import { loadGuideOffers } from "@/entities/subscription.catalog.server";
import { GuideModeHint, GuideModeSwitch } from "@/features/guide-modes";
import { loadReaderGuideMode } from "@/features/guide-modes.reader.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { GuideModeProvider, defaultGuideMode } from "@/shared/guide-mode";
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
  // Режим нужен только внутри руководства, поэтому вне его за ним никто не ходит.
  const insideGuide =
    returnTarget.kind === "series" && returnTarget.seriesSlug !== undefined;
  const [result, seriesResult, guideMode] = await Promise.all([
    loadMaterialReader(slug, accessToken),
    insideGuide && returnTarget.seriesSlug !== undefined
      ? loadPublishedSeries(returnTarget.seriesSlug, accessToken)
      : Promise.resolve(null),
    insideGuide
      ? loadReaderGuideMode(accessToken)
      : Promise.resolve(defaultGuideMode),
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
    // Материал может входить в несколько руководств, поэтому без пути захода продаётся только
    // единственное: наугад выбранное руководство открыло бы человеку не то, за чем он пришёл.
    const memberships = result.material.seriesMemberships;
    const guideSlug =
      returnTarget.kind === "series"
        ? returnTarget.seriesSlug
        : memberships.length === 1
          ? memberships[0]?.series.slug
          : undefined;
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
  const showsModes = seriesContext?.series.hasModeVariants === true;
  return (
    <VisibleMaterialOpen key={`${result.material.materialId}:${String(result.material.contentVersion)}`} materialId={result.material.materialId} contentVersion={result.material.contentVersion}>
    <GuideModeProvider initialMode={guideMode}>
    <MaterialReaderView
      readingAction={<SavedReadingAction key={result.material.materialId} materialId={result.material.materialId} format={result.material.format.slug} />}
      bookmarkAction={<SavedBookmarkAction materialId={result.material.materialId} />}
      body={result.body}
      material={result.material}
      {...(showsModes
        ? {
            modeHint: <GuideModeHint />,
            modeSwitch: <GuideModeSwitch signedIn={accessToken !== undefined} />,
          }
        : {})}
      primaryVideo={result.primaryVideo}
      returnTarget={effectiveReturnTarget}
      seriesContext={seriesContext}
    />
    </GuideModeProvider>
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
