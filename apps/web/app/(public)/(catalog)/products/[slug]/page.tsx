import type { Metadata } from "next";

import { productLinkPreview } from "@/_pages/library-discovery";
import { PublishedProductPage } from "@/_pages/library-discovery.server";
import { readPublicProduct } from "@/features/library-discovery.server";
import {
  hiddenPageMetadata,
  publicPageMetadata,
  unavailablePageMetadata,
} from "@/shared/link-preview";
import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";

interface ProductPageProps {
  readonly params: Promise<{ readonly slug: string }>;
  readonly searchParams: Promise<{
    readonly from?: string | readonly string[];
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
}: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await readPublicProduct(slug);
  if (result.kind === "not-found") {
    return hiddenPageMetadata("Продукт не найден");
  }
  if (result.kind === "unavailable") {
    return unavailablePageMetadata("Продукт недоступен");
  }
  return publicPageMetadata(
    await readPublicSiteOrigin(),
    "website",
    productLinkPreview(result.reference),
  );
}

/** Скелет маршрута даёт `loading.tsx`; страница читает адрес уже под ним (ADR 0027). */
export default function ProductRoute({
  params,
  searchParams,
}: ProductPageProps) {
  return <PublishedProductPage params={params} searchParams={searchParams} />;
}
