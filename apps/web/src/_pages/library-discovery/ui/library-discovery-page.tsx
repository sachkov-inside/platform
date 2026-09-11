import { PersonalSeries } from "./personal-series.server";
import { notFound } from "next/navigation";

import { loadGuideOffer } from "@/entities/subscription.server";

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
import type { PriceSnapshot } from "@/entities/subscription";
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
  // The artifact section and the guide price are both addressed by Guide id, which only a
  // resolved Guide carries. A not-found or unavailable result never reaches either at all.
  const guideId =
    result.kind === "ready" || result.kind === "empty"
      ? result.reference.id
      : undefined;
  // Руководство продаётся, только когда владелец завёл ему цену: её отсутствие — обычное состояние.
  const [artifacts, catalog] = await Promise.all([
    guideId === undefined
      ? Promise.resolve<ReaderGuideArtifactsResult>({ artifacts: [], kind: "ready" })
      : readReaderGuideArtifacts(guideId, accessToken),
    guideId === undefined ? Promise.resolve(undefined) : loadGuideOffer(guideId),
  ]);
  return renderPublishedSeriesResult(result, slug, {
    ...(returnTarget === undefined ? {} : { returnTarget }),
    ...(accessToken === undefined ? {} : { accessToken }),
    artifacts,
    guideOffer: catalog?.kind === "ready" ? catalog.offer : null,
  });
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
  readonly accessToken?: string;
  readonly artifacts: ReaderGuideArtifactsResult;
  /** Разовая цена руководства, когда владелец её завёл. */
  readonly guideOffer?: PriceSnapshot | null;
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
    <PersonalSeries
      artifacts={conditions.artifacts}
      guideOffer={conditions.guideOffer ?? null}
      result={result}
      {...(conditions.accessToken === undefined
        ? {}
        : { accessToken: conditions.accessToken })}
      {...(conditions.returnTarget === undefined
        ? {}
        : { returnTarget: conditions.returnTarget })}
    />
  );
}
