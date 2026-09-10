import { PersonalSeries } from "./personal-series.server";
import { notFound } from "next/navigation";

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
  // The artifact section is addressed by Guide id, which only a resolved Guide has.
  const artifacts =
    result.kind === "ready" || result.kind === "empty"
      ? await readReaderGuideArtifacts(result.reference.id ?? "", accessToken)
      : ({ artifacts: [], kind: "ready" } as const);
  return renderPublishedSeriesResult(
    result,
    artifacts,
    slug,
    returnTarget,
    accessToken,
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
  artifacts: ReaderGuideArtifactsResult,
  slug: string,
  returnTarget?: MaterialReaderReturnTarget,
  accessToken?: string,
) {
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable kind="series" slug={slug} />;
  }
  return (
    <PersonalSeries
      artifacts={artifacts}
      result={result}
      {...(accessToken === undefined ? {} : { accessToken })}
      {...(returnTarget === undefined ? {} : { returnTarget })}
    />
  );
}
