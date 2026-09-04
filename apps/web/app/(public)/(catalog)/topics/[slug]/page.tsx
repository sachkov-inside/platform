import type { Metadata } from "next";

import { loadPublishedTopic } from "@/features/library-discovery.server";
import { PublishedTopicPage } from "@/_pages/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { parseMaterialReaderReturnTarget } from "@/shared/routing/material-reader";

interface TopicPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{ readonly from?: string | readonly string[] }>;
}

export async function generateMetadata({
  params,
}: TopicPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadPublishedTopic(
    slug,
    await getOptionalPlatformAccessToken(),
  );
  return result.kind === "ready" || result.kind === "empty"
    ? {
        title: `${result.reference.name} — тема`,
        description: `Опубликованные материалы по теме «${result.reference.name}».`,
      }
    : { title: result.kind === "not-found" ? "Тема не найдена" : "Тема недоступна" };
}

export default async function TopicRoute({ params, searchParams }: TopicPageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <PublishedTopicPage
      {...(accessToken === undefined ? {} : { accessToken })}
      returnTarget={parseMaterialReaderReturnTarget(query.from)}
      slug={slug}
    />
  );
}
