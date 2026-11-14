import type { Metadata } from "next";

import { CourseGlossaryPage } from "@/_pages/course-glossary.server";
import { readPublicProduct } from "@/features/library-discovery.server";

interface CourseGlossaryRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
}

/**
 * Сколько секунд браузер помнит эту страницу вместе с личной частью (ADR 0027). Значение —
 * литерал: Next.js читает конфигурацию сегмента статически.
 */
export const unstable_dynamicStaleTime = 60;

export async function generateMetadata({
  params,
}: CourseGlossaryRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await readPublicProduct(slug);
  return result.kind === "ready" || result.kind === "empty"
    ? {
        title: `Словарь · ${result.reference.name}`,
        description: `Термины курса «${result.reference.name}» со ссылками на уроки, где они введены.`,
      }
    : {
        title:
          result.kind === "not-found" ? "Курс не найден" : "Курс недоступен",
      };
}

/** Скелет маршрута даёт `loading.tsx`; страница читает адрес уже под ним (ADR 0027). */
export default function CourseGlossaryRoute({
  params,
}: CourseGlossaryRouteProps) {
  return <CourseGlossaryPage params={params} />;
}
