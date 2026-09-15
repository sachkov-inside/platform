import { SavedReadingAction, VisibleMaterialOpen } from "@/features/reading-progress";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { notFound } from "next/navigation";

import { loadGuideOffers } from "@/entities/subscription.catalog.server";
import { GuideModeHint, GuideModeSwitch } from "@/features/guide-modes";
import {
  loadReaderGuideMode,
  readerHasSeenGuideModeHint,
} from "@/features/guide-modes.reader.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { GuideModeProvider, defaultGuideMode } from "@/shared/guide-mode";
import { loadMaterialReader } from "../api/load-material-reader";
import { soleSoldGuide } from "../model/purchase-guide";
import { resolveSeriesReaderContext } from "../model/series-reader-context";
import {
  homeMaterialReaderReturnTarget,
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
  const guideSlug =
    returnTarget.kind === "series" ? returnTarget.seriesSlug : undefined;
  const [result, seriesResult, guideMode, hintSeen] = await Promise.all([
    loadMaterialReader(slug, accessToken),
    guideSlug === undefined
      ? Promise.resolve(null)
      : loadPublishedSeries(guideSlug, accessToken),
    guideSlug === undefined
      ? Promise.resolve(defaultGuideMode)
      : loadReaderGuideMode(accessToken),
    guideSlug === undefined
      ? Promise.resolve(true)
      : readerHasSeenGuideModeHint(),
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
      ? homeMaterialReaderReturnTarget
      : returnTarget;
  if (result.kind === "access") {
    // Руководство, которым человек занят, важнее тарифов: если у него есть своя цена, дальше
    // идёт его оплата. Без пути захода призыв ведёт к единственному продаваемому продукту среди
    // продуктов материала: наугад выбранное руководство открыло бы человеку не то, за чем он пришёл.
    const returnGuideSlug =
      returnTarget.kind === "series" ? returnTarget.seriesSlug : undefined;
    const purchaseGuide =
      returnGuideSlug !== undefined
        ? { slug: returnGuideSlug, sold: await guideIsSold(returnGuideSlug, accessToken) }
        : await soleSoldMembership(
            result.material.seriesMemberships.map(({ series }) => series.slug),
            accessToken,
          );
    const invitation = purchaseInvitation({
      ...(purchaseGuide === undefined ? {} : { guide: purchaseGuide }),
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
  // Подсказка объясняет устройство руководства у шага, который читатель видит. Шаг, написанный
  // для другого способа, в его режиме не рисуется, и подсказка стояла бы рядом с пустотой.
  const hintAt = result.body.findIndex(
    (block) =>
      block.kind === "variant" &&
      block.options.some((option) => option.mode === guideMode),
  );
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
            ...(hintSeen || hintAt < 0
              ? {}
              : { modeHint: { at: hintAt, node: <GuideModeHint /> } }),
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

/** Единственное продаваемое руководство материала, если такое есть. */
async function soleSoldMembership(
  slugs: readonly string[],
  accessToken?: string,
): Promise<{ readonly slug: string; readonly sold: true } | undefined> {
  const guides = await Promise.all(
    slugs.map(async (slug) => ({ slug, sold: await guideIsSold(slug, accessToken) })),
  );
  const slug = soleSoldGuide(guides);
  return slug === undefined ? undefined : { slug, sold: true };
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
    returnTarget.href,
  );
}
