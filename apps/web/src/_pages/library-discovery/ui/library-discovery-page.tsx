import { PersonalSeries } from "./personal-series.server";
import { notFound } from "next/navigation";

import { loadGuideOffers } from "@/entities/subscription.server";

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
 * Программа руководства: материалы по главам и цена сверху. Прогресс читателя принадлежит ей,
 * поэтому именно здесь он и запрашивается.
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
    return <LibraryDiscoveryUnavailable kind="series" slug={slug} />;
  }
  const guideId = result.reference.id;
  // Руководство продаётся, только когда владелец завёл ему цену: её отсутствие — обычное состояние.
  const [artifacts, catalog] = await Promise.all([
    guideId === undefined
      ? Promise.resolve<ReaderGuideArtifactsResult>({ artifacts: [], kind: "ready" })
      : readReaderGuideArtifacts(guideId, accessToken),
    guideId === undefined ? Promise.resolve(undefined) : loadGuideOffers(guideId),
  ]);
  return (
    <PersonalSeries
      artifacts={artifacts}
      guideOffer={catalog?.kind === "ready" ? catalog.offers[0] ?? null : null}
      result={result}
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
    return <LibraryDiscoveryUnavailable kind="topic" slug={slug} />;
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
    return <LibraryDiscoveryUnavailable kind="series" slug={slug} />;
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
