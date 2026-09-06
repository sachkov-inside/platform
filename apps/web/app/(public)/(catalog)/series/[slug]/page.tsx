import type { Metadata } from "next";

import { loadPublishedSeries } from "@/features/library-discovery.server";
import { PublishedSeriesPage } from "@/_pages/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
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
  return result.kind === "ready" || result.kind === "empty"
    ? {
        title: `${result.reference.name} — серия`,
        description: `Опубликованные материалы серии «${result.reference.name}» в авторском порядке.`,
      }
    : {
        title:
          result.kind === "not-found" ? "Серия не найдена" : "Серия недоступна",
      };
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
