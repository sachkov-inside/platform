import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { loadBillingOffers } from "@/entities/subscription.server";
import { guidePurchaseOffers, publicSubscriptionOffers } from "@/entities/subscription";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import {
  readPublicGuideArtifacts,
  readReaderGuideArtifacts,
} from "@/features/guide-artifacts.server";
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
import { PersonalSeries } from "./personal-series.server";
import { PendingSeries } from "./saved-series.client";

interface DiscoveryRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{ readonly from?: string | readonly string[] | undefined }>;
}

type ResolvedSeries = Extract<PublishedSeriesResult, { readonly kind: "ready" | "empty" }>;

const noArtifacts: ReaderGuideArtifactsResult = { artifacts: [], kind: "ready" };

/**
 * Тема целиком общая: справка и связанные продукты одинаковы для всех, а материалы темы читает
 * браузер. Страница рисуется из гостевого кеша и личной части не имеет (ADR 0027).
 */
export async function PublishedTopicPage({ params, searchParams }: DiscoveryRouteProps) {
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
 * Страница продукта рассказывает о нём и ничего не знает о читателе: состав, главы и артефакты
 * как обещание результата приходят из гостевого кеша. Доступ и оплата живут в программе.
 */
export async function PublishedSeriesPage({ params, searchParams }: DiscoveryRouteProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await readPublicSeries(slug);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable />;
  }
  return (
    <LibraryDiscoveryView
      artifacts={await publicArtifactsOf(result)}
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
export async function GuideProgrammePage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;
  const result = await readPublicSeries(slug);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable />;
  }
  const artifacts = await publicArtifactsOf(result);
  return (
    <Suspense
      fallback={<PendingSeries artifacts={artifacts} result={result} />}
    >
      <PersonalProgramme sharedArtifacts={artifacts} sharedResult={result} slug={slug} />
    </Suspense>
  );
}

/** Личная часть программы: ничего из прочитанного здесь не кешируется и не предзагружается. */
async function PersonalProgramme({
  sharedArtifacts,
  sharedResult,
  slug,
}: {
  readonly sharedArtifacts: ReaderGuideArtifactsResult;
  readonly sharedResult: ResolvedSeries;
  readonly slug: string;
}) {
  // Личная часть принадлежит запросу, а не предзагрузке: `connection()` останавливает её до чтения
  // сессии, чтобы предзагрузка по намерению не дошла до обновления токена.
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  // Идентификатор руководства не зависит от читателя, поэтому личные чтения идут разом.
  const guideId = sharedResult.reference.id;
  // Публичный каталог отдаёт только включённое в продажу, поэтому один запрос отвечает сразу на
  // два вопроса программы: продаётся ли это руководство и есть ли вообще что предложить на витрине
  // подписки. На второй отвечает её собственный отбор: звать туда, где пусто, нельзя.
  const [result, artifacts, catalog] = await Promise.all([
    accessToken === undefined ? sharedResult : loadPublishedSeries(slug, accessToken),
    accessToken === undefined || guideId === undefined
      ? sharedArtifacts
      : readReaderGuideArtifacts(guideId, accessToken),
    loadBillingOffers(),
  ]);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable />;
  }
  const forSale = catalog.kind === "ready" ? catalog.offers : [];
  // Программе хватает самого дешёвого варианта: он решает, приглашать ли к оплате.
  // Выбор между вариантами живёт на странице оплаты, где их видно составом и ценой.
  const programmeOffer =
    guideId === undefined ? null : guidePurchaseOffers(forSale, guideId)[0] ?? null;
  return (
    <PersonalSeries
      artifacts={artifacts}
      guideOffer={programmeOffer}
      result={result}
      subscriptionOffered={publicSubscriptionOffers(forSale).length > 0}
      {...(accessToken === undefined ? {} : { accessToken })}
    />
  );
}

/** Раздел артефактов адресуется по id руководства, который несёт только разрешённый результат. */
function publicArtifactsOf(result: ResolvedSeries): Promise<ReaderGuideArtifactsResult> {
  const guideId = result.reference.id;
  return guideId === undefined ? Promise.resolve(noArtifacts) : readPublicGuideArtifacts(guideId);
}
