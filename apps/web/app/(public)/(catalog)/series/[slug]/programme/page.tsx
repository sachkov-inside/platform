import type { Metadata } from "next";

import { GuideProgrammePage } from "@/_pages/library-discovery.server";
import { readPublicSeries } from "@/features/library-discovery.server";

interface GuideProgrammeRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Сколько секунд браузер помнит эту страницу вместе с личной частью: повторный переход в этом окне
 * идёт без запроса. Решение владельца 17.09.2026 (ADR 0027). Значение — литерал: Next.js читает
 * конфигурацию сегмента статически.
 */
export const unstable_dynamicStaleTime = 60;

export async function generateMetadata({
  params,
}: GuideProgrammeRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await readPublicSeries(slug);
  return result.kind === "ready" || result.kind === "empty"
    ? {
        title: `Программа · ${result.reference.name}`,
        description: `Материалы продукта «${result.reference.name}» по главам в авторском порядке.`,
      }
    : {
        title:
          result.kind === "not-found"
            ? "Продукт не найден"
            : "Продукт недоступен",
      };
}

/** Скелет маршрута даёт `loading.tsx`; страница читает адрес уже под ним (ADR 0027). */
export default function GuideProgrammeRoute({ params }: GuideProgrammeRouteProps) {
  return <GuideProgrammePage params={params} />;
}
