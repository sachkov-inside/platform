import { ProductTaskPage } from "@/_pages/product-task.server";
import { hiddenPageMetadata } from "@/shared/link-preview";

// Явный тип, а не сгенерированный `PageProps`: проверка типами в lint идёт до `next typegen`.
interface ProductTaskRouteProps {
  readonly searchParams: Promise<{
    readonly attemptsAfter?: string | readonly string[];
  }>;
  readonly params: Promise<{ readonly slug: string; readonly code: string }>;
}

/** Same browser retention window as lessons; successful submissions refresh the route. */
export const unstable_dynamicStaleTime = 60;

/** Рабочая страница ученика, а не витрина: в поиск она не идёт. */
export const metadata = hiddenPageMetadata("Задание");

/** Скелет маршрута даёт `loading.tsx`; страница читает адрес уже под ним. */
export default function ProductTaskRoute({
  params,
  searchParams,
}: ProductTaskRouteProps) {
  return <ProductTaskPage params={params} searchParams={searchParams} />;
}
