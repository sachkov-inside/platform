import "server-only";

import { readProductReaderState } from "@/widgets/product-reader-state/index.server";
import { courseLearningAction } from "@/features/ai-engineering-course";
import { saleDiscount } from "@/entities/subscription";

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

/**
 * Скидка на курс для бейджа карточки: её видит тот, кому курс ещё не открыт. Цена читается вместе
 * с остальным состоянием читателя, а не из общего кеша Главной: кеш не держит цен и скидок.
 */
export async function readHomeCourseDiscount(productId: string, slug: string) {
  const state = await readProductReaderState(productId, slug);
  if (state.kind === "learning" || state.sale.kind !== "ready") return null;
  return saleDiscount(state.sale.offers[0] ?? null);
}
