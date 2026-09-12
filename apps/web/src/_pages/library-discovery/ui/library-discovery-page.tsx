import { PersonalSeries } from "./personal-series.server";
import { notFound } from "next/navigation";

import { loadBillingOffers } from "@/entities/subscription.server";
import { guidePurchaseOffers, publicSubscriptionOffers } from "@/entities/subscription";

import type {
  PublishedSeriesResult,
  PublishedTopicResult,
} from "@/features/library-discovery";
import { readReaderGuideArtifacts } from "@/features/guide-artifacts.server";
import {
  loadPublishedSeries,
  loadPublishedTopic,
} from "@/features/library-discovery.server";
import {
  LibraryDiscoveryUnavailable,
  LibraryDiscoveryView,
} from "./library-discovery-view";
import type { ReaderGuideArtifactsResult } from "@/features/guide-artifacts.reader";
import { topicPath } from "@/shared/routing/public-page-path";
import { guideProductHref, guideProgrammeHref } from "@/shared/routing/subscription-route";
import type { MaterialReaderReturnTarget } from "@/shared/routing/material-reader";

export async function PublishedTopicPage({
  accessToken,
  returnTarget,
  slug,
}: {
  readonly accessToken?: string;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly slug: string;
}) {
  return renderPublishedTopicResult(
    await loadPublishedTopic(slug, accessToken),
    slug,
    returnTarget,
  );
}

export async function PublishedSeriesPage({
  accessToken,
  returnTarget,
  slug,
}: {
  readonly accessToken?: string;
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly slug: string;
}) {
  const result = await loadPublishedSeries(slug, accessToken);
  // Раздел артефактов адресуется по id руководства, который несёт только разрешённый результат.
  const guideId =
    result.kind === "ready" || result.kind === "empty"
      ? result.reference.id
      : undefined;
  const artifacts: ReaderGuideArtifactsResult =
    guideId === undefined
      ? { artifacts: [], kind: "ready" }
      : await readReaderGuideArtifacts(guideId, accessToken);
  return renderPublishedSeriesResult(result, slug, {
    ...(returnTarget === undefined ? {} : { returnTarget }),
    artifacts,
  });
}

/**
 * Программа руководства: материалы по главам и приглашение к оплате сверху. Прогресс читателя
 * принадлежит ей, поэтому именно здесь он и запрашивается.
 */
export async function GuideProgrammePage({
  accessToken,
  slug,
}: {
  readonly accessToken?: string;
  readonly slug: string;
}) {
  const result = await loadPublishedSeries(slug, accessToken);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable retryHref={guideProgrammeHref(slug)} />;
  }
  const guideId = result.reference.id;
  // Публичный каталог отдаёт только включённое в продажу, поэтому один запрос отвечает сразу на
  // два вопроса программы: продаётся ли это руководство и есть ли вообще что предложить на витрине
  // подписки. На второй отвечает её собственный отбор: звать туда, где пусто, нельзя.
  const [artifacts, catalog] = await Promise.all([
    guideId === undefined
      ? Promise.resolve<ReaderGuideArtifactsResult>({ artifacts: [], kind: "ready" })
      : readReaderGuideArtifacts(guideId, accessToken),
    loadBillingOffers(),
  ]);
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

function renderPublishedTopicResult(
  result: PublishedTopicResult,
  slug: string,
  returnTarget?: MaterialReaderReturnTarget,
) {
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable retryHref={topicPath(slug)} />;
  }
  return (
    <LibraryDiscoveryView
      result={result}
      {...(returnTarget === undefined ? {} : { returnTarget })}
    />
  );
}

interface SeriesRenderConditions {
  readonly returnTarget?: MaterialReaderReturnTarget;
  readonly artifacts: ReaderGuideArtifactsResult;
}

function renderPublishedSeriesResult(
  result: PublishedSeriesResult,
  slug: string,
  conditions: SeriesRenderConditions,
) {
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable retryHref={guideProductHref(slug)} />;
  }
  return (
    <LibraryDiscoveryView
      artifacts={conditions.artifacts}
      result={result}
      {...(conditions.returnTarget === undefined
        ? {}
        : { returnTarget: conditions.returnTarget })}
    />
  );
}
