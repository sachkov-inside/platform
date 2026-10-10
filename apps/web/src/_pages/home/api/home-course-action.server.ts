import "server-only";

import { readProductAccess } from "@/entities/subscription.sale.server";
import { courseLearningAction } from "@/features/ai-engineering-course";
import { getSeriesContinuation } from "@/features/reading-progress.server";
import { readAuthenticatedSession } from "@/shared/auth/index.server";

/** Личная кнопка закрепа читается вне общего кеша, после остановки предзагрузки сессии. */
export async function readHomeCourseAction(productId: string, slug: string) {
  const session = await readAuthenticatedSession("rsc");
  if (session.kind !== "ready") return null;
  if ((await readProductAccess(productId, session.value)) !== "open")
    return null;
  const progress = await getSeriesContinuation(slug, session.value);
  return courseLearningAction(
    slug,
    progress.kind === "ready"
      ? (progress.continuation?.materialSlug ?? null)
      : null,
  );
}
