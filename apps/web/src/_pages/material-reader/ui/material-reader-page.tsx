import { SavedReadingAction, VisibleMaterialOpen } from "@/features/reading-progress";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { notFound } from "next/navigation";

import { GuideModeHint, GuideModeSwitch } from "@/features/guide-modes";
import {
  loadReaderGuideMode,
  readerHasSeenGuideModeHint,
} from "@/features/guide-modes.reader.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { GuideModeProvider, defaultGuideMode } from "@/shared/guide-mode";
import { loadMaterialReader } from "../api/load-material-reader";
import { resolveSeriesReaderContext } from "../model/series-reader-context";
import {
  homeMaterialReaderReturnTarget,
  materialReaderHref,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { guidePurchaseHref } from "@/shared/routing/subscription-route";
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
    // Закрытый урок ведёт к покупке выбранного руководства. Подписка не является запасной продажей.
    // При нескольких руководствах без контекста не выбираем одно наугад.
    const memberships = result.material.seriesMemberships;
    const guideSlug =
      returnTarget.kind === "series"
        ? returnTarget.seriesSlug
        : memberships.length === 1
          ? memberships[0]?.series.slug
          : undefined;
    const invitation = guideSlug === undefined ? null : { kind: "guide" as const, href: guidePurchaseHref(guideSlug) };
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


function currentMaterialHref(slug: string, returnTarget: MaterialReaderReturnTarget) {
  return materialReaderHref(slug, returnTarget.href);
}
