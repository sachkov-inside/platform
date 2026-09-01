import { notFound } from "next/navigation";

import type {
  LibraryDiscoveryKind,
  LibraryDiscoveryResult,
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
  return renderDiscoveryResult(
    await loadPublishedTopic(slug, accessToken),
    "topic",
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
  return renderDiscoveryResult(
    await loadPublishedSeries(slug, accessToken),
    "series",
    slug,
  );
}

function renderDiscoveryResult(
  result: LibraryDiscoveryResult,
  kind: Exclude<LibraryDiscoveryKind, "related">,
  slug: string,
) {
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable kind={kind} slug={slug} />;
  }
  return <LibraryDiscoveryView result={result} />;
}
