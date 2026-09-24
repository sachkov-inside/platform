import type { Metadata } from "next";

import { topicLinkPreview } from "@/_pages/library-discovery";
import { PublishedTopicPage } from "@/_pages/library-discovery.server";
import { readPublicTopic } from "@/features/library-discovery.server";
import {
  hiddenPageMetadata,
  publicPageMetadata,
  unavailablePageMetadata,
} from "@/shared/link-preview";
import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";

interface TopicPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{ readonly from?: string | readonly string[] }>;
}

/**
 * Сколько секунд браузер помнит эту страницу вместе с личной частью: повторный переход в этом окне
 * идёт без запроса. Решение владельца 17.09.2026 (ADR 0027). Значение — литерал: Next.js читает
 * конфигурацию сегмента статически.
 */
export const unstable_dynamicStaleTime = 60;

export async function generateMetadata({
  params,
}: TopicPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await readPublicTopic(slug);
  if (result.kind === "not-found") {
    return hiddenPageMetadata("Тема не найдена");
  }
  if (result.kind === "unavailable") {
    return unavailablePageMetadata("Тема недоступна");
  }
  return publicPageMetadata(
    await readPublicSiteOrigin(),
    "website",
    topicLinkPreview(result.reference),
  );
}

/** Скелет маршрута даёт `loading.tsx`; страница читает адрес уже под ним (ADR 0027). */
export default function TopicRoute({ params, searchParams }: TopicPageProps) {
  return <PublishedTopicPage params={params} searchParams={searchParams} />;
}
