import { connection } from "next/server";

import { notFound } from "next/navigation";

import { topicSocialCard } from "@/_pages/library-discovery";
import { loadPublishedTopic } from "@/features/library-discovery.server";
import { socialCardResponse } from "@/shared/link-preview/index.server";

/** Карточка ссылки на тему без обложки. */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  await connection();
  const { slug } = await context.params;
  const result = await loadPublishedTopic(slug);
  if (result.kind === "not-found" || result.kind === "unavailable") {
    notFound();
  }
  return socialCardResponse(topicSocialCard(result.reference));
}
