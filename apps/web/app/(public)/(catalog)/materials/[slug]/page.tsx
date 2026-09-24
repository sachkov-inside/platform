import type { Metadata } from "next";

import { materialLinkPreview } from "@/_pages/material-reader";
import { loadMaterialPreview, MaterialReaderPage } from "@/_pages/material-reader.server";
import {
  hiddenPageMetadata,
  publicPageMetadata,
  unavailablePageMetadata,
} from "@/shared/link-preview";
import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";

// Явный тип, а не сгенерированный `PageProps`: проверка типами в lint идёт до `next typegen`.
interface MaterialPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{
    readonly from?: string | readonly string[] | undefined;
  }>;
}

/**
 * Сколько секунд браузер помнит эту страницу вместе с личной частью: повторный переход в этом окне
 * идёт без запроса. Решение владельца 17.09.2026 (ADR 0027). Значение — литерал: Next.js читает
 * конфигурацию сегмента статически.
 */
export const unstable_dynamicStaleTime = 60;

export async function generateMetadata({
  params,
}: MaterialPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadMaterialPreview(slug);
  if (result.kind === "not-found") {
    return hiddenPageMetadata("Материал не найден");
  }
  if (result.kind === "unavailable") {
    return unavailablePageMetadata("Материал временно недоступен");
  }
  return publicPageMetadata(
    await readPublicSiteOrigin(),
    "article",
    materialLinkPreview(result.material),
  );
}

/** Скелет маршрута даёт `loading.tsx`; страница читает адрес уже под ним (ADR 0027). */
export default function MaterialRoute({ params, searchParams }: MaterialPageProps) {
  return <MaterialReaderPage params={params} searchParams={searchParams} />;
}
