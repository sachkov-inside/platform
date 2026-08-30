import type { Metadata } from "next";

import {
  getPublishedTopic,
  LibraryDiscoveryPage,
} from "@/_pages/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

interface TopicPageProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({
  params,
}: TopicPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getPublishedTopic(
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

export default async function Page({ params }: TopicPageProps) {
  const { slug } = await params;
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <LibraryDiscoveryPage
      {...(accessToken === undefined ? {} : { accessToken })}
      kind="topic"
      slug={slug}
    />
  );
}
