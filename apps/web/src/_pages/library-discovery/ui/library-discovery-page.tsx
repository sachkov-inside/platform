import { PersonalSeries } from "./personal-series.server";
import { notFound } from "next/navigation";

import { loadGuideOffer } from "@/entities/subscription.server";

import type {
  PublishedSeriesResult,
  PublishedTopicResult,
} from "@/features/library-discovery";
import {
  loadPublishedSeries,
  loadPublishedTopic,
} from "@/features/library-discovery.server";
import {
  LibraryDiscoveryUnavailable,
  LibraryDiscoveryView,
} from "./library-discovery-view";
import type { PriceSnapshot } from "@/entities/subscription";
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
  const id =
    result.kind === "ready" || result.kind === "empty"
      ? result.reference.id
      : undefined;
  // Руководство продаётся, только когда владелец завёл ему цену: её отсутствие — обычное состояние.
  const catalog = id === undefined ? undefined : await loadGuideOffer(id);
  return renderPublishedSeriesResult(
    result,
    slug,
    returnTarget,
    accessToken,
    catalog?.kind === "ready" ? catalog.offer : null,
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

function renderPublishedSeriesResult(
  result: PublishedSeriesResult,
  slug: string,
  returnTarget?: MaterialReaderReturnTarget,
  accessToken?: string,
  guideOffer: PriceSnapshot | null = null,
) {
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable kind="series" slug={slug} />;
  }
  return (
    <PersonalSeries
      guideOffer={guideOffer}
      result={result}
      {...(accessToken === undefined ? {} : { accessToken })}
      {...(returnTarget === undefined ? {} : { returnTarget })}
    />
  );
}
