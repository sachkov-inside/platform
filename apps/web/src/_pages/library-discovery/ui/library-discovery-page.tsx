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

export async function PublishedTopicPage({
  accessToken,
  slug,
}: {
  readonly accessToken?: string;
  readonly slug: string;
}) {
  return renderPublishedTopicResult(
    await loadPublishedTopic(slug, accessToken),
    slug,
  );
}

export async function PublishedSeriesPage({
  accessToken,
  slug,
}: {
  readonly accessToken?: string;
  readonly slug: string;
}) {
  return renderPublishedSeriesResult(
    await loadPublishedSeries(slug, accessToken),
    slug,
  );
}

function renderPublishedTopicResult(
  result: PublishedTopicResult,
  slug: string,
) {
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable kind="topic" slug={slug} />;
  }
  return <LibraryDiscoveryView result={result} />;
}

function renderPublishedSeriesResult(
  result: PublishedSeriesResult,
  slug: string,
) {
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable kind="series" slug={slug} />;
  }
  return <LibraryDiscoveryView result={result} />;
}
