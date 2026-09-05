import { notFound } from "next/navigation";

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
  return renderPublishedSeriesResult(
    await loadPublishedSeries(slug, accessToken),
    slug,
    returnTarget,
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
) {
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable kind="series" slug={slug} />;
  }
  return (
    <LibraryDiscoveryView
      result={result}
      {...(returnTarget === undefined ? {} : { returnTarget })}
    />
  );
}
