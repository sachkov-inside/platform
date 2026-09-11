import { notFound } from "next/navigation";

import { loadPublishedTopic } from "@/features/library-discovery.server";
import { socialCardResponse } from "@/shared/link-preview/index.server";

/** Карточка ссылки на тему без обложки. */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const result = await loadPublishedTopic(slug);
  if (result.kind === "not-found" || result.kind === "unavailable") {
    notFound();
  }
  return socialCardResponse({ eyebrow: "Тема", title: result.reference.name });
}
