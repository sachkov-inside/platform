import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { preorderPrice } from "@/entities/subscription";
import {
  readGuestProductSale,
  readViewerProductSale,
} from "@/entities/subscription.sale.server";
import type { OneTimeOfferTerms } from "@/features/billing-checkout.terms";
import { readPublicProductOfferTerms } from "@/features/billing-checkout.terms.server";
import type { ReaderProductArtifactsResult } from "@/features/product-artifacts.reader";
import {
  readPublicProductArtifacts,
  readReaderProductArtifacts,
} from "@/features/product-artifacts.server";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import {
  loadPublishedSeries,
  readPublicSeries,
  readPublicTopic,
} from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

import {
  LibraryDiscoveryUnavailable,
  LibraryDiscoveryView,
} from "./library-discovery-view";
import {
  PendingCohortCall,
  PersonalCohortCall,
  PersonalCohortCountdown,
  PersonalCohortStatus,
} from "./cohort-call.server";
import { PersonalSeries } from "./personal-series.server";
import { PendingSeries } from "./product-programme-view";
import {
  ProductLandingLoading,
  ProductProgrammeLoading,
} from "./library-discovery-loading";

interface DiscoveryRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{
    readonly from?: string | readonly string[] | undefined;
  }>;
}

type ResolvedSeries = Extract<
  PublishedSeriesResult,
  { readonly kind: "ready" | "empty" }
>;

const noArtifacts: ReaderProductArtifactsResult = {
  artifacts: [],
  kind: "ready",
};

/**
 * Тема целиком общая: справка и связанные продукты одинаковы для всех, а материалы темы читает
 * браузер. Страница рисуется из гостевого кеша и личной части не имеет (ADR 0027).
 */
export async function PublishedTopicPage({
  params,
  searchParams,
}: DiscoveryRouteProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await readPublicTopic(slug);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable />;
  }
  return (
    <LibraryDiscoveryView
      result={result}
      returnTarget={parseMaterialReaderReturnTarget(query.from)}
    />
  );
}

/**
 * Страница продукта рассказывает о нём: состав, главы и артефакты как обещание результата приходят
 * из гостевого кеша. О читателе знает только первый экран курса с потоком: плашка этапа и кнопка
 * по нему стримятся личной частью. Доступ по урокам живёт в программе.
 */
export async function PublishedSeriesPage({
  params,
  searchParams,
}: DiscoveryRouteProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await readPublicSeries(slug);
  if (result.kind === "not-found") {
    return (
      <Suspense fallback={<ProductLandingLoading />}>
        <PersonalProduct
          slug={slug}
          returnTarget={parseMaterialReaderReturnTarget(query.from)}
        />
      </Suspense>
    );
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable />;
  }
  const [artifacts, offerTerms] = await Promise.all([
    publicArtifactsOf(result),
    publicOfferTermsOf(result),
  ]);
  return (
    <LibraryDiscoveryView
      artifacts={artifacts}
      // Поток и кнопка по этапу продаж — единственная личная часть страницы продукта. Её рисует
      // только оформление, у которого она есть; остальные продукты её не запрашивают (#814).
      heroCall={
        <Suspense fallback={<PendingCohortCall slug={slug} />}>
          <PersonalCohortCall result={result} />
        </Suspense>
      }
      statusCall={
        <Suspense fallback={null}>
          <PersonalCohortStatus result={result} />
        </Suspense>
      }
      heroBadge={
        <Suspense fallback={null}>
          <PersonalCohortCountdown result={result} />
        </Suspense>
      }
      offerTerms={offerTerms}
      result={result}
      returnTarget={parseMaterialReaderReturnTarget(query.from)}
    />
  );
}

/**
 * Программа руководства: материалы по главам и приглашение к оплате сверху. Состав и названия
 * приходят из гостевого кеша и видны сразу; доступность для читателя, артефакты с адресами,
 * предложение и прогресс — личная часть, она встаёт на место отметок «уточняется» (ADR 0027).
 */
export async function ProductProgrammePage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;
  const result = await readPublicSeries(slug);
  if (result.kind === "not-found") {
    return (
      <Suspense fallback={<ProductProgrammeLoading />}>
        <PersonalProgramme slug={slug} />
      </Suspense>
    );
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable />;
  }
  const artifacts = await publicArtifactsOf(result);
  return (
    <Suspense
      fallback={<PendingSeries artifacts={artifacts} result={result} />}
    >
      <PersonalProgramme
        sharedArtifacts={artifacts}
        sharedResult={result}
        slug={slug}
      />
    </Suspense>
  );
}

/** Архивный продукт определяется только запросом держателя после гостевого «не найдено». */
async function PersonalProduct({
  slug,
  returnTarget,
}: {
  readonly slug: string;
  readonly returnTarget: ReturnType<typeof parseMaterialReaderReturnTarget>;
}) {
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  if (accessToken === undefined) notFound();
  const result = await loadPublishedSeries(slug, accessToken);
  if (result.kind === "not-found") notFound();
  if (result.kind === "unavailable") return <LibraryDiscoveryUnavailable />;
  const [artifacts, offerTerms] = await Promise.all([
    result.reference.id === undefined
      ? noArtifacts
      : readReaderProductArtifacts(result.reference.id, accessToken),
    publicOfferTermsOf(result),
  ]);
  return (
    <LibraryDiscoveryView
      artifacts={artifacts}
      offerTerms={offerTerms}
      result={result}
      heroCall={<PersonalCohortCall result={result} />}
      statusCall={<PersonalCohortStatus result={result} />}
      heroBadge={<PersonalCohortCountdown result={result} />}
      returnTarget={returnTarget}
    />
  );
}

/** Личная часть программы: ничего из прочитанного здесь не кешируется и не предзагружается. */
async function PersonalProgramme({
  sharedArtifacts,
  sharedResult,
  slug,
}: {
  readonly sharedArtifacts?: ReaderProductArtifactsResult;
  readonly sharedResult?: ResolvedSeries;
  readonly slug: string;
}) {
  // Личная часть принадлежит запросу, а не предзагрузке: `connection()` останавливает её до чтения
  // сессии, чтобы предзагрузка по намерению не дошла до обновления токена.
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  if (sharedResult === undefined && accessToken === undefined) notFound();
  const resolved =
    sharedResult ?? (await loadPublishedSeries(slug, accessToken));
  if (resolved.kind === "not-found") notFound();
  if (resolved.kind === "unavailable") return <LibraryDiscoveryUnavailable />;
  // Идентификатор руководства не зависит от читателя, поэтому личные чтения идут разом.
  const productId = resolved.reference.id;
  const [result, artifacts, sale] = await Promise.all([
    accessToken === undefined
      ? resolved
      : loadPublishedSeries(slug, accessToken),
    accessToken === undefined || productId === undefined
      ? (sharedArtifacts ?? noArtifacts)
      : readReaderProductArtifacts(productId, accessToken),
    productId === undefined
      ? null
      : accessToken === undefined
        ? readGuestProductSale(productId)
        : readViewerProductSale(productId, accessToken),
  ]);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable />;
  }
  return (
    <PersonalSeries
      artifacts={artifacts}
      preorder={
        sale?.kind === "ready" && sale.access !== "open"
          ? preorderPrice(sale.cohort, sale.offers[0] ?? null)
          : null
      }
      productOffer={sale?.kind === "ready" ? (sale.offers[0] ?? null) : null}
      result={result}
      subscriptionOffered={false}
      {...(accessToken === undefined ? {} : { accessToken })}
    />
  );
}

/** Раздел артефактов адресуется по id руководства, который несёт только разрешённый результат. */
function publicArtifactsOf(
  result: ResolvedSeries,
): Promise<ReaderProductArtifactsResult> {
  const productId = result.reference.id;
  return productId === undefined
    ? Promise.resolve(noArtifacts)
    : readPublicProductArtifacts(productId);
}

/**
 * Сроки для подстановок в описании продукта — из его предложения для всех. Продукт без описания
 * их не спрашивает; сбой чтения не выдумывает срок: подстановка остаётся без чисел.
 */
async function publicOfferTermsOf(
  result: ResolvedSeries,
): Promise<OneTimeOfferTerms | null> {
  const productId = result.reference.id;
  if (
    productId === undefined ||
    (result.reference.productPage?.page ?? null) === null
  )
    return null;
  const terms = await readPublicProductOfferTerms(productId);
  return terms.kind === "ready" ? terms.terms : null;
}
