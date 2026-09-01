import type { Metadata } from "next";

import { loadPublishedSeries } from "@/features/library-discovery.server";
import { PublishedSeriesPage } from "@/_pages/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

interface SeriesPageProps {
  readonly params: Promise<{ readonly slug: string }>;
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
        title: `${result.reference.name} — плейлист`,
        description: `Опубликованные материалы плейлиста «${result.reference.name}» в авторском порядке.`,
      }
    : {
        title:
          result.kind === "not-found" ? "Плейлист не найден" : "Плейлист недоступен",
      };
}

export default async function SeriesRoute({ params }: SeriesPageProps) {
  const { slug } = await params;
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <PublishedSeriesPage
      {...(accessToken === undefined ? {} : { accessToken })}
      slug={slug}
    />
  );
}
