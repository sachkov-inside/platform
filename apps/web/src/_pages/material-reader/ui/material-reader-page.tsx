import {
  LearningPracticeDisclosure,
  LearningPracticePrompts,
} from "./learning-practice-prompts";
import { loadLearningPractices } from "../api/load-learning-practices.server";
import {
  SavedReadingAction,
  VisibleMaterialOpen,
} from "@/features/reading-progress";
import { SavedBookmarkAction } from "@/features/bookmarks";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";

import {
  readGuestProductSale,
  readViewerProductSale,
} from "@/entities/subscription.sale.server";
import { ProductModeHint, ProductModeSwitch } from "@/features/product-modes";
import {
  loadReaderProductMode,
  readerHasSeenProductModeHint,
} from "@/features/product-modes.reader.server";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import {
  loadPublishedSeries,
  readPublicSeries,
} from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { readWebRuntimeConfig } from "@/shared/config/index.server";
import {
  publicPageUrl,
  readPublicSiteOrigin,
} from "@/shared/link-preview/index.server";
import type { ReaderLearnerMcp } from "../model/practice-review-setup";
import {
  ProductModeProvider,
  defaultProductMode,
  type ProductMode,
} from "@/shared/product-mode";
import { loadMaterialReader } from "../api/load-material-reader";
import { readPublicMaterial } from "../api/public-material.public-cache.server";
import type {
  MaterialReaderResult,
  PublicMaterialResult,
} from "../model/material-reader-view";
import { soleSoldProduct } from "../model/purchase-product";
import {
  resolveSeriesReaderContext,
  type SeriesReaderContext,
} from "../model/series-reader-context";
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

type ResolvedMaterial = Extract<
  MaterialReaderResult,
  { readonly kind: "available" | "access" }
>;

/**
 * Общая часть урока (ADR 0027). Адрес читается здесь, под скелетом маршрута; метаданные и состав
 * продукта приходят из гостевого кеша, поэтому шапка, возврат и соседи по продукту появляются
 * сразу. Личная часть — тело закрытого урока, предложение о покупке, режим прохождения — стримится
 * на место тела. Бесплатное тело не ждёт личных заданий: их кнопка занимает место в строке
 * нижних действий, а полное содержимое появляется только по действию читателя.
 */
export async function MaterialReaderPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{
    readonly from?: string | readonly string[] | undefined;
  }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const returnTarget = parseMaterialReaderReturnTarget(query.from);
  // Состав нужен только внутри руководства, поэтому вне его за ним никто не ходит.
  const productSlug = productSlugOf(returnTarget);
  const [material, series] = await Promise.all([
    readPublicMaterial(slug),
    productSlug === undefined
      ? Promise.resolve(null)
      : readPublicSeries(productSlug),
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
  const seriesContext = seriesContextOf(
    material.material.slug,
    returnTarget,
    series,
  );
  const effectiveReturnTarget = effectiveReturnTargetOf(
    returnTarget,
    seriesContext,
  );
  if (
    material.kind === "available" &&
    seriesContext?.series.hasModeVariants !== true
  ) {
    return (
      <ResolvedMaterialReader
        productMode={defaultProductMode}
        hintSeen
        deferredPracticeActions={
          <Suspense fallback={<LearningPracticeDisclosure result={null} />}>
            <PublicMaterialPractice slug={slug} />
          </Suspense>
        }
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
      <PersonalMaterialReader
        sharedMaterial={material}
        returnTarget={returnTarget}
        slug={slug}
      />
    </Suspense>
  );
}

/** The existing action row holds private practice without an extra empty loading row. */
async function PublicMaterialPractice({ slug }: { readonly slug: string }) {
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  const result =
    accessToken === undefined
      ? { kind: "available" as const, practices: [] }
      : await loadLearningPractices(slug, accessToken);
  return (
    <LearningPracticeDisclosure
      connection={await readerLearnerMcp()}
      result={result}
    />
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
  const productSlug = productSlugOf(returnTarget);
  // Гостю закрытый урок откроет только покупка, поэтому предложение ищется сразу, а не после
  // личного чтения. Вошедшему урок может быть открыт, и лишний запрос каталога ему не нужен.
  const guestPurchaseProduct =
    accessToken === undefined && sharedMaterial?.kind === "teaser"
      ? resolvePurchaseProduct(sharedMaterial.material, returnTarget, undefined)
      : undefined;
  // Если личное чтение закончится не отказом, поиск никто не дождётся: его сбой не должен остаться
  // необработанным. Тот, кто дождётся, получит исключение как обычно.
  guestPurchaseProduct?.catch(() => undefined);
  const [result, seriesResult, productMode, hintSeen, practices] =
    await Promise.all([
      sharedMaterial?.kind === "available"
        ? Promise.resolve(sharedMaterial)
        : loadMaterialReader(slug, accessToken),
      productSlug === undefined
        ? Promise.resolve(null)
        : readSeriesAs(productSlug, accessToken),
      productSlug === undefined
        ? Promise.resolve(defaultProductMode)
        : loadReaderProductMode(accessToken),
      productSlug === undefined
        ? Promise.resolve(true)
        : readerHasSeenProductModeHint(),
      accessToken === undefined
        ? Promise.resolve({ kind: "available" as const, practices: [] })
        : loadLearningPractices(slug, accessToken),
    ]);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <ReaderUnavailable returnTarget={returnTarget} />;
  }
  const seriesContext = seriesContextOf(
    result.material.slug,
    returnTarget,
    seriesResult,
  );
  return (
    <ResolvedMaterialReader
      {...(accessToken === undefined ? {} : { accessToken })}
      {...(guestPurchaseProduct === undefined
        ? {}
        : { purchaseProduct: guestPurchaseProduct })}
      productMode={productMode}
      practiceActions={
        <LearningPracticePrompts
          connection={await readerLearnerMcp()}
          result={practices}
        />
      }
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
  productMode,
  hintSeen,
  practiceActions,
  deferredPracticeActions,
  purchaseProduct: startedPurchaseProduct,
  result,
  returnTarget,
  seriesContext,
  slug,
}: {
  readonly accessToken?: string;
  /** Поиск предложения, начатый до личного чтения. */
  readonly purchaseProduct?: Promise<PurchaseProduct | undefined>;
  readonly practiceActions?: ReactNode;
  readonly deferredPracticeActions?: ReactNode;
  readonly productMode: ProductMode;
  readonly hintSeen: boolean;
  readonly result: ResolvedMaterial;
  readonly returnTarget: MaterialReaderReturnTarget;
  readonly seriesContext: SeriesReaderContext | null;
  readonly slug: string;
}) {
  if (result.kind === "access") {
    const purchaseProduct = await (startedPurchaseProduct ??
      resolvePurchaseProduct(result.material, returnTarget, accessToken));
    const invitation = purchaseInvitation({
      ...(purchaseProduct === undefined ? {} : { product: purchaseProduct }),
      from: materialReaderHref(slug, returnTarget.href),
      subscriptionOffered: result.subscriptionOffered,
    });
    return (
      <MaterialReaderAccess
        readingAction={
          <SavedReadingAction
            key={result.material.materialId}
            materialId={result.material.materialId}
            format={result.material.format.slug}
            canMark={false}
          />
        }
        invitation={invitation}
        material={result.material}
        returnTarget={returnTarget}
        seriesContext={seriesContext}
      />
    );
  }
  const showsModes = seriesContext?.series.hasModeVariants === true;
  // Подсказка объясняет устройство руководства у шага, который читатель видит. Шаг, написанный
  // для другого способа, в его режиме не рисуется, и подсказка стояла бы рядом с пустотой.
  const hintAt = result.body.findIndex(
    (block) =>
      block.kind === "variant" &&
      block.options.some((option) => option.mode === productMode),
  );
  return (
    <VisibleMaterialOpen
      key={`${result.material.materialId}:${String(result.material.contentVersion)}`}
      materialId={result.material.materialId}
      contentVersion={result.material.contentVersion}
    >
      <ProductModeProvider initialMode={productMode}>
        <MaterialReaderView
          topReadingAction={
            <SavedReadingAction
              compact
              materialId={result.material.materialId}
              format={result.material.format.slug}
            />
          }
          topBookmarkAction={
            <SavedBookmarkAction
              compact
              materialId={result.material.materialId}
            />
          }
          readingAction={
            <SavedReadingAction
              compact
              key={result.material.materialId}
              materialId={result.material.materialId}
              format={result.material.format.slug}
            />
          }
          bookmarkAction={
            <SavedBookmarkAction
              compact
              materialId={result.material.materialId}
            />
          }
          practiceActions={practiceActions}
          deferredPracticeActions={deferredPracticeActions}
          body={result.body}
          material={result.material}
          {...(showsModes
            ? {
                ...(hintSeen || hintAt < 0
                  ? {}
                  : { modeHint: { at: hintAt, node: <ProductModeHint /> } }),
                modeSwitch: (
                  <ProductModeSwitch signedIn={accessToken !== undefined} />
                ),
              }
            : {})}
          primaryVideo={result.primaryVideo}
          returnTarget={returnTarget}
          seriesContext={seriesContext}
        />
      </ProductModeProvider>
    </VisibleMaterialOpen>
  );
}

/** Продукт, из которого урок открыт; вне продукта его нет. */
function productSlugOf(
  returnTarget: MaterialReaderReturnTarget,
): string | undefined {
  return returnTarget.kind === "series" ? returnTarget.seriesSlug : undefined;
}

/** Состав продукта глазами читателя: гостю хватает общего кеша, вошедшему нужен его собственный. */
function readSeriesAs(
  slug: string,
  accessToken: string | undefined,
): Promise<PublishedSeriesResult> {
  return accessToken === undefined
    ? readPublicSeries(slug)
    : loadPublishedSeries(slug, accessToken);
}

/** Без урока нет и его места в продукте, поэтому возврат в продукт заменяется возвратом на Главную. */
function ReaderUnavailable({
  returnTarget,
}: {
  readonly returnTarget: MaterialReaderReturnTarget;
}) {
  return (
    <MaterialReaderUnavailable
      returnTarget={effectiveReturnTargetOf(returnTarget, null)}
    />
  );
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

interface PurchaseProduct {
  readonly slug: string;
  readonly sold: boolean;
}

/**
 * Руководство, которым человек занят, важнее тарифов: если у него есть своя цена, дальше идёт его
 * оплата. Без пути захода призыв ведёт к единственному продаваемому продукту среди продуктов
 * материала: наугад выбранное руководство открыло бы человеку не то, за чем он пришёл.
 */
function resolvePurchaseProduct(
  material: ResolvedMaterial["material"],
  returnTarget: MaterialReaderReturnTarget,
  accessToken: string | undefined,
): Promise<PurchaseProduct | undefined> {
  const returnProductSlug = productSlugOf(returnTarget);
  return returnProductSlug !== undefined
    ? productIsSold(returnProductSlug, accessToken).then((sold) => ({
        slug: returnProductSlug,
        sold,
      }))
    : soleSoldMembership(
        material.seriesMemberships.map(({ series }) => series.slug),
        accessToken,
      );
}

/** Единственное продаваемое руководство материала, если такое есть. */
async function soleSoldMembership(
  slugs: readonly string[],
  accessToken?: string,
): Promise<{ readonly slug: string; readonly sold: true } | undefined> {
  const products = await Promise.all(
    slugs.map(async (slug) => ({
      slug,
      sold: await productIsSold(slug, accessToken),
    })),
  );
  const slug = soleSoldProduct(products);
  return slug === undefined ? undefined : { slug, sold: true };
}

/** Руководство продаётся, только когда владелец завёл ему цену; сбой каталога её не выдумывает. */
async function productIsSold(
  slug: string,
  accessToken?: string,
): Promise<boolean> {
  const product = await readSeriesAs(slug, accessToken);
  const productId =
    product.kind === "ready" || product.kind === "empty"
      ? product.reference.id
      : undefined;
  if (productId === undefined) return false;
  const sale = await (accessToken === undefined
    ? readGuestProductSale(productId)
    : readViewerProductSale(productId, accessToken));
  return sale.kind === "ready" && sale.sold;
}

/** Учебный MCP из конфигурации и абсолютный адрес инструкции, которую читает агент ученика. */
async function readerLearnerMcp(): Promise<ReaderLearnerMcp> {
  return {
    ...readWebRuntimeConfig().learnerMcp,
    setupUrl: publicPageUrl(
      await readPublicSiteOrigin(),
      "/practice-review-setup.txt",
    ),
  };
}
