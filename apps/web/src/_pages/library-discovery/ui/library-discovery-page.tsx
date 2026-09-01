import { notFound } from "next/navigation";

import type { LibraryDiscoveryKind } from "@/features/library-discovery";
import { loadLibraryDiscovery } from "@/features/library-discovery.server";
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
  const result = await loadLibraryDiscovery(kind, slug, accessToken);
  if (result.kind === "not-found") {
    notFound();
  }
  if (result.kind === "unavailable") {
    return <LibraryDiscoveryUnavailable kind={kind} slug={slug} />;
  }
  return <LibraryDiscoveryView result={result} />;
}
