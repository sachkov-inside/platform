import type { Metadata } from "next";

import { topicLinkPreview } from "@/_pages/library-discovery";
import { loadPublishedTopic } from "@/features/library-discovery.server";
import { PublishedTopicPage } from "@/_pages/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { hiddenPageMetadata, publicPageMetadata } from "@/shared/link-preview";
import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";
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
  if (result.kind === "not-found") {
    return hiddenPageMetadata("Тема не найдена");
  }
  if (result.kind === "unavailable") {
    return hiddenPageMetadata("Тема недоступна");
  }
  return publicPageMetadata(
    await readPublicSiteOrigin(),
    "website",
    topicLinkPreview(result.reference),
  );
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
