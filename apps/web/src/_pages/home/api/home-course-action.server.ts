import "server-only";

import { readProductReaderState } from "@/widgets/product-reader-state/index.server";
import { courseLearningAction } from "@/features/ai-engineering-course";

/** Home displays the same request-scoped Product state as the Product page. */
export async function readHomeCourseAction(productId: string, slug: string) {
  const state = await readProductReaderState(productId, slug);
  if (state.kind !== "learning") return null;
  return courseLearningAction(
    slug,
    state.continuation.kind === "ready"
      ? (state.continuation.continuation?.materialSlug ?? null)
      : null,
  );
}
