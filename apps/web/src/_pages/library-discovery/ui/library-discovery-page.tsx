import { notFound } from "next/navigation";

import {
  getPublishedSeries,
  getPublishedTopic,
} from "@/_pages/library-discovery/api/get-library-discovery";
import type { LibraryDiscoveryKind } from "@/_pages/library-discovery/model/library-discovery-view";
import {
  LibraryDiscoveryUnavailable,
  LibraryDiscoveryView,
} from "./library-discovery-view";

export async function LibraryDiscoveryPage({
  accessToken,
  kind,
  slug,
}: {
  readonly accessToken?: string;
  readonly kind: Exclude<LibraryDiscoveryKind, "related">;
  readonly slug: string;
}) {
  const result = await (kind === "topic" ? getPublishedTopic : getPublishedSeries)(
    slug,
    accessToken,
  );
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable kind={kind} slug={slug} />;
  }
  return <LibraryDiscoveryView result={result} />;
}
