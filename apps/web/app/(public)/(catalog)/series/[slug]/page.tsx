import type { Metadata } from "next";

import { guideLinkPreview } from "@/_pages/library-discovery";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { PublishedSeriesPage } from "@/_pages/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import {
  hiddenPageMetadata,
  publicPageMetadata,
  unavailablePageMetadata,
} from "@/shared/link-preview";
import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

interface SeriesPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{ readonly from?: string | readonly string[] }>;
}

export async function generateMetadata({
  params,
}: SeriesPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadPublishedSeries(
    slug,
    await getOptionalPlatformAccessToken(),
  );
  if (result.kind === "not-found") {
    return hiddenPageMetadata("Руководство не найдено");
  }
  if (result.kind === "unavailable") {
    return unavailablePageMetadata("Руководство недоступно");
  }
  return publicPageMetadata(
    await readPublicSiteOrigin(),
    "website",
    guideLinkPreview(result.reference),
  );
}

export default async function SeriesRoute({ params, searchParams }: SeriesPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <PublishedSeriesPage
      {...(accessToken === undefined ? {} : { accessToken })}
      returnTarget={parseMaterialReaderReturnTarget(query.from)}
      slug={slug}
    />
  );
}
