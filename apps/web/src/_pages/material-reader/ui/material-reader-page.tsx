import { proseLinkClassName } from "@/shared/ui/prose-link";
import {
  anchoredMaterialHref,
  parseReaderCourseAnchor,
  type ReaderCourseAnchor,
} from "@/shared/routing/reader-course-anchor";
import { IntentPrefetchLink } from "@/shared/ui/intent-prefetch-link.client";
import { ReaderInlineArtifact } from "@/features/product-artifacts.server";
import {
  InlineArtifactDownload,
  readInlineArtifactReference,
} from "@/features/product-artifacts.reader";
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
  resolvePurchaseProduct,
  type PurchaseProductResult,
} from "../api/resolve-purchase-product.server";
import { resolveReaderReturnTarget } from "../model/reader-return-target";
import { readReaderSeries } from "../api/read-reader-series.server";
import { readPublicSeries } from "@/features/library-discovery.server";
import { ProductModeHint, ProductModeSwitch } from "@/features/product-modes";
import {
  loadReaderProductMode,
  readerHasSeenProductModeHint,
} from "@/features/product-modes.reader.server";
import type { PublishedSeriesResult } from "@/features/library-discovery";
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
import {
  resolveSeriesReaderContext,
  type SeriesReaderContext,
} from "../model/series-reader-context";
import {
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
    readonly anchor?: string | readonly string[] | undefined;
  }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const returnTarget = parseMaterialReaderReturnTarget(query.from);
  const anchor = parseReaderCourseAnchor(query.anchor);
  const inferCourseReturn = query.from === undefined;
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
        <PersonalMaterialReader
          anchor={anchor}
          returnTarget={returnTarget}
          inferCourseReturn={inferCourseReturn}
          slug={slug}
        />
      </Suspense>
    );
  }
  const seriesContext = seriesContextOf(
    material.material.slug,
    returnTarget,
    series,
  );
  const effectiveReturnTarget = resolveReaderReturnTarget({
    returnTarget,
    material: material.material,
    hasSeriesContext: seriesContext !== null,
    inferCourseReturn,
  });
  if (
    material.kind === "available" &&
    seriesContext?.series.hasModeVariants !== true &&
    anchor === undefined
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
        anchor={anchor}
        sharedMaterial={material}
        inferCourseReturn={inferCourseReturn}
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
  anchor,
  sharedMaterial,
  inferCourseReturn,
  returnTarget,
  slug,
}: {
  readonly anchor?: ReaderCourseAnchor | undefined;
  /** Бесплатный урок уже прочитан из общего кеша: личной остаётся только выбор режима. */
  readonly sharedMaterial?: PublicMaterialResult;
  readonly inferCourseReturn: boolean;
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
      ? resolvePurchaseProduct(
          sharedMaterial.material,
          productSlugOf(returnTarget),
          undefined,
        )
      : undefined;
  // Если личное чтение закончится не отказом, поиск никто не дождётся: его сбой не должен остаться
  // необработанным. Тот, кто дождётся, получит исключение как обычно.
  guestPurchaseProduct?.catch(() => undefined);
  const [result, seriesResult, productMode, hintSeen] = await Promise.all([
    sharedMaterial?.kind === "available"
      ? Promise.resolve(sharedMaterial)
      : loadMaterialReader(slug, accessToken),
    productSlug === undefined
      ? Promise.resolve(null)
      : readReaderSeries(productSlug, accessToken),
    productSlug === undefined
      ? Promise.resolve(defaultProductMode)
      : loadReaderProductMode(accessToken),
    productSlug === undefined
      ? Promise.resolve(true)
      : readerHasSeenProductModeHint(),
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
    anchor,
  );
  return (
    <ResolvedMaterialReader
      {...(accessToken === undefined ? {} : { accessToken })}
      {...(guestPurchaseProduct === undefined
        ? {}
        : { purchaseProduct: guestPurchaseProduct })}
      productMode={productMode}
      practiceActions={
        accessToken === undefined ? undefined : (
          <Suspense fallback={null}>
            <PrivateMaterialPractice slug={slug} accessToken={accessToken} />
          </Suspense>
        )
      }
      hintSeen={hintSeen}
      result={result}
      returnTarget={resolveReaderReturnTarget({
        returnTarget,
        material: result.material,
        hasSeriesContext: seriesContext !== null,
        inferCourseReturn,
      })}
      seriesContext={seriesContext}
      slug={slug}
    />
  );
}

/** Optional Practice never delays the authorized body or its required mode/navigation context. */
async function PrivateMaterialPractice({
  slug,
  accessToken,
}: {
  readonly slug: string;
  readonly accessToken: string;
}) {
  const [result, connection] = await Promise.all([
    loadLearningPractices(slug, accessToken),
    readerLearnerMcp(),
  ]);
  return <LearningPracticePrompts connection={connection} result={result} />;
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
  readonly purchaseProduct?: Promise<PurchaseProductResult>;
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
      resolvePurchaseProduct(
        result.material,
        productSlugOf(returnTarget),
        accessToken,
      ));
    if (purchaseProduct.kind === "unavailable")
      return <ReaderUnavailable returnTarget={returnTarget} />;
    const invitation = purchaseInvitation({
      ...(purchaseProduct.product === undefined
        ? {}
        : { product: purchaseProduct.product }),
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
  const showsModes =
    seriesContext?.supplementary !== true &&
    seriesContext?.series.hasModeVariants === true;
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
          renderLink={(href, label) => {
            const reference = readInlineArtifactReference(href);
            if (reference === undefined) {
              const programme = seriesContext?.programme;
              if (programme == null) return undefined;
              const current = programme.current;
              const contextAnchor = parseReaderCourseAnchor(current.id);
              const target =
                contextAnchor === undefined
                  ? undefined
                  : anchoredMaterialHref(href, programme.href, contextAnchor);
              return target === undefined ? undefined : (
                <IntentPrefetchLink
                  className={proseLinkClassName}
                  href={target}
                >
                  {label}
                </IntentPrefetchLink>
              );
            }
            return (
              <Suspense
                fallback={
                  <InlineArtifactDownload href={href} label={label} loading />
                }
              >
                <ReaderInlineArtifact
                  reference={reference}
                  href={href}
                  label={label}
                />
              </Suspense>
            );
          }}
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

/** Без урока нет и его места в продукте, поэтому возврат в продукт заменяется возвратом на Главную. */
function ReaderUnavailable({
  returnTarget,
}: {
  readonly returnTarget: MaterialReaderReturnTarget;
}) {
  return (
    <MaterialReaderUnavailable
      returnTarget={resolveReaderReturnTarget({ returnTarget })}
    />
  );
}

function seriesContextOf(
  currentMaterialSlug: string,
  returnTarget: MaterialReaderReturnTarget,
  series: PublishedSeriesResult | null,
  anchor?: ReaderCourseAnchor,
): SeriesReaderContext | null {
  return series?.kind === "ready"
    ? resolveSeriesReaderContext({
        currentMaterialSlug,
        returnTarget,
        series,
        anchor,
      })
    : null;
}

/** Absolute setup URL stays request-owned with the runtime learner connection. */
async function readerLearnerMcp(): Promise<ReaderLearnerMcp> {
  return {
    ...readWebRuntimeConfig().learnerMcp,
    setupUrl: publicPageUrl(
      await readPublicSiteOrigin(),
      "/practice-review-setup.txt",
    ),
  };
}
