import { SavedReadingAction, VisibleMaterialOpen } from "@/features/reading-progress";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { loadGuideOffers } from "@/entities/subscription.catalog.server";
import { GuideModeHint, GuideModeSwitch } from "@/features/guide-modes";
import {
  loadReaderGuideMode,
  readerHasSeenGuideModeHint,
} from "@/features/guide-modes.reader.server";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { loadPublishedSeries, readPublicSeries } from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { GuideModeProvider, defaultGuideMode, type GuideMode } from "@/shared/guide-mode";
import { loadMaterialReader } from "../api/load-material-reader";
import { readPublicMaterial } from "../api/public-material.public-cache.server";
import type { MaterialReaderResult, PublicMaterialResult } from "../model/material-reader-view";
import { soleSoldGuide } from "../model/purchase-guide";
import { resolveSeriesReaderContext, type SeriesReaderContext } from "../model/series-reader-context";
import {
  homeMaterialReaderReturnTarget,
  materialReaderHref,
  parseMaterialReaderReturnTarget,
  type MaterialReaderReturnTarget,
} from "@/shared/routing/material-reader";
import { purchaseInvitation } from "@/shared/routing/subscription-route";
import {
  MaterialReaderAccess,
  MaterialReaderLoading,
  MaterialReaderPending,
  MaterialReaderUnavailable,
} from "./material-reader-states";
import { MaterialReaderView } from "./material-reader-view";

type ResolvedMaterial = Extract<MaterialReaderResult, { readonly kind: "available" | "access" }>;

/**
 * Общая часть урока (ADR 0027). Адрес читается здесь, под скелетом маршрута; метаданные и состав
 * продукта приходят из гостевого кеша, поэтому шапка, возврат и соседи по продукту появляются
 * сразу. Личная часть — тело закрытого урока, предложение о покупке, режим прохождения — стримится
 * на место тела. Бесплатный урок без режимов личной части не имеет и рисуется целиком отсюда.
 */
export async function MaterialReaderPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{ readonly from?: string | readonly string[] | undefined }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const returnTarget = parseMaterialReaderReturnTarget(query.from);
  // Состав нужен только внутри руководства, поэтому вне его за ним никто не ходит.
  const guideSlug = guideSlugOf(returnTarget);
  const [material, series] = await Promise.all([
    readPublicMaterial(slug),
    guideSlug === undefined ? Promise.resolve(null) : readPublicSeries(guideSlug),
  ]);
  if (material.kind === "unavailable") {
    return <ReaderUnavailable returnTarget={returnTarget} />;
  }
  if (material.kind === "not-found") {
    // Гостю материала нет, но вошедшему он может быть открыт: это знает только личное чтение.
    return (
      <Suspense fallback={<MaterialReaderLoading />}>
        <PersonalMaterialReader returnTarget={returnTarget} slug={slug} />
      </Suspense>
    );
  }
  const seriesContext = seriesContextOf(material.material.slug, returnTarget, series);
  const effectiveReturnTarget = effectiveReturnTargetOf(returnTarget, seriesContext);
  if (material.kind === "available" && seriesContext?.series.hasModeVariants !== true) {
    return (
      <ResolvedMaterialReader
        guideMode={defaultGuideMode}
        hintSeen
        result={material}
        returnTarget={effectiveReturnTarget}
        seriesContext={seriesContext}
        slug={slug}
      />
    );
  }
  return (
    <Suspense
      fallback={
        <MaterialReaderPending
          material={material.material}
          returnTarget={effectiveReturnTarget}
          seriesContext={seriesContext}
        />
      }
    >
      <PersonalMaterialReader sharedMaterial={material} returnTarget={returnTarget} slug={slug} />
    </Suspense>
  );
}

/**
 * Личная часть: читает сессию и спрашивает backend от имени читателя. Ничего из прочитанного здесь
 * не кешируется и в предзагрузку не попадает.
 */
async function PersonalMaterialReader({
  sharedMaterial,
  returnTarget,
  slug,
}: {
  /** Бесплатный урок уже прочитан из общего кеша: личной остаётся только выбор режима. */
  readonly sharedMaterial?: PublicMaterialResult;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly slug: string;
}) {
  // Личная часть принадлежит запросу, а не предзагрузке: `connection()` останавливает её до чтения
  // сессии. Иначе предзагрузка по намерению дошла бы до обновления токена и до cookie режима.
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  // Гость, которому backend урока не показал, личным чтением ничего нового не узнает.
  if (accessToken === undefined && sharedMaterial === undefined) {
    notFound();
  }
  const guideSlug = guideSlugOf(returnTarget);
  // Гостю закрытый урок откроет только покупка, поэтому предложение ищется сразу, а не после
  // личного чтения. Вошедшему урок может быть открыт, и лишний запрос каталога ему не нужен.
  const guestPurchaseGuide =
    accessToken === undefined && sharedMaterial?.kind === "teaser"
      ? resolvePurchaseGuide(sharedMaterial.material, returnTarget, undefined)
      : undefined;
  // Если личное чтение закончится не отказом, поиск никто не дождётся: его сбой не должен остаться
  // необработанным. Тот, кто дождётся, получит исключение как обычно.
  guestPurchaseGuide?.catch(() => undefined);
  const [result, seriesResult, guideMode, hintSeen] = await Promise.all([
    sharedMaterial?.kind === "available"
      ? Promise.resolve(sharedMaterial)
      : loadMaterialReader(slug, accessToken),
    guideSlug === undefined ? Promise.resolve(null) : readSeriesAs(guideSlug, accessToken),
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
  if (result.kind === "unavailable") {
    return <ReaderUnavailable returnTarget={returnTarget} />;
  }
  const seriesContext = seriesContextOf(result.material.slug, returnTarget, seriesResult);
  return (
    <ResolvedMaterialReader
      {...(accessToken === undefined ? {} : { accessToken })}
      {...(guestPurchaseGuide === undefined ? {} : { purchaseGuide: guestPurchaseGuide })}
      guideMode={guideMode}
      hintSeen={hintSeen}
      result={result}
      returnTarget={effectiveReturnTargetOf(returnTarget, seriesContext)}
      seriesContext={seriesContext}
      slug={slug}
    />
  );
}

async function ResolvedMaterialReader({
  accessToken,
  guideMode,
  hintSeen,
  purchaseGuide: startedPurchaseGuide,
  result,
  returnTarget,
  seriesContext,
  slug,
}: {
  readonly accessToken?: string;
  /** Поиск предложения, начатый до личного чтения. */
  readonly purchaseGuide?: Promise<PurchaseGuide | undefined>;
  readonly guideMode: GuideMode;
  readonly hintSeen: boolean;
  readonly result: ResolvedMaterial;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly seriesContext: SeriesReaderContext | null;
  readonly slug: string;
}) {
  if (result.kind === "access") {
    const purchaseGuide = await (startedPurchaseGuide ??
      resolvePurchaseGuide(result.material, returnTarget, accessToken));
    const invitation = purchaseInvitation({
      ...(purchaseGuide === undefined ? {} : { guide: purchaseGuide }),
      from: materialReaderHref(slug, returnTarget.href),
      subscriptionOffered: result.subscriptionOffered,
    });
    return (
      <div className="@container/material-reader">
        <MaterialReaderAccess
          readingAction={<SavedReadingAction key={result.material.materialId} materialId={result.material.materialId} format={result.material.format.slug} canMark={false} />}
          invitation={invitation}
          material={result.material}
          returnTarget={returnTarget}
          seriesContext={seriesContext}
        />
      </div>
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
      returnTarget={returnTarget}
      seriesContext={seriesContext}
    />
    </GuideModeProvider>
    </VisibleMaterialOpen>
  );
}

/** Продукт, из которого урок открыт; вне продукта его нет. */
function guideSlugOf(returnTarget: MaterialReaderReturnTarget): string | undefined {
  return returnTarget.kind === "series" ? returnTarget.seriesSlug : undefined;
}

/** Состав продукта глазами читателя: гостю хватает общего кеша, вошедшему нужен его собственный. */
function readSeriesAs(slug: string, accessToken: string | undefined): Promise<PublishedSeriesResult> {
  return accessToken === undefined ? readPublicSeries(slug) : loadPublishedSeries(slug, accessToken);
}

/** Без урока нет и его места в продукте, поэтому возврат в продукт заменяется возвратом на Главную. */
function ReaderUnavailable({ returnTarget }: { readonly returnTarget: MaterialReaderReturnTarget }) {
  return <MaterialReaderUnavailable returnTarget={effectiveReturnTargetOf(returnTarget, null)} />;
}

function seriesContextOf(
  currentMaterialSlug: string,
  returnTarget: MaterialReaderReturnTarget,
  series: PublishedSeriesResult | null,
): SeriesReaderContext | null {
  return series?.kind === "ready"
    ? resolveSeriesReaderContext({ currentMaterialSlug, returnTarget, series })
    : null;
}

/** Возврат в продукт, в котором урока нет, заменяется возвратом на Главную. */
function effectiveReturnTargetOf(
  returnTarget: MaterialReaderReturnTarget,
  seriesContext: SeriesReaderContext | null,
): MaterialReaderReturnTarget {
  return returnTarget.kind === "series" && seriesContext === null
    ? homeMaterialReaderReturnTarget
    : returnTarget;
}

interface PurchaseGuide {
  readonly slug: string;
  readonly sold: boolean;
}

/**
 * Руководство, которым человек занят, важнее тарифов: если у него есть своя цена, дальше идёт его
 * оплата. Без пути захода призыв ведёт к единственному продаваемому продукту среди продуктов
 * материала: наугад выбранное руководство открыло бы человеку не то, за чем он пришёл.
 */
function resolvePurchaseGuide(
  material: ResolvedMaterial["material"],
  returnTarget: MaterialReaderReturnTarget,
  accessToken: string | undefined,
): Promise<PurchaseGuide | undefined> {
  const returnGuideSlug = guideSlugOf(returnTarget);
  return returnGuideSlug !== undefined
    ? guideIsSold(returnGuideSlug, accessToken).then((sold) => ({ slug: returnGuideSlug, sold }))
    : soleSoldMembership(material.seriesMemberships.map(({ series }) => series.slug), accessToken);
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
  const guide = await readSeriesAs(slug, accessToken);
  const guideId =
    guide.kind === "ready" || guide.kind === "empty" ? guide.reference.id : undefined;
  if (guideId === undefined) return false;
  const offers = await loadGuideOffers(guideId);
  return offers.kind === "ready" && offers.offers.length > 0;
}
