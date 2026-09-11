import { notFound } from "next/navigation";

import { loadPublishedSeries } from "@/features/library-discovery.server";
import { socialCardResponse } from "@/shared/link-preview/index.server";

/** Карточка ссылки на руководство без обложки. */
export async function GET(
  _request: Request,
  context: { readonly params: Promise<{ readonly slug: string }> },
): Promise<Response> {
  const { slug } = await context.params;
  const result = await loadPublishedSeries(slug);
  if (result.kind === "not-found" || result.kind === "unavailable") {
    notFound();
  }
  return socialCardResponse({ eyebrow: "Руководство", title: result.reference.name });
}
