import { GuideTaskPage } from "@/_pages/guide-task.server";
import { hiddenPageMetadata } from "@/shared/link-preview";

// Явный тип, а не сгенерированный `PageProps`: проверка типами в lint идёт до `next typegen`.
interface GuideTaskRouteProps {
  readonly params: Promise<{ readonly slug: string; readonly code: string }>;
}

/** Страница читает сессию до отрисовки: доступ, требования и свои сдачи личные (#947). */
export const instant = false;

/** Рабочая страница ученика, а не витрина: в поиск она не идёт. */
export const metadata = hiddenPageMetadata("Задание");

/** Скелет маршрута даёт `loading.tsx`; страница читает адрес уже под ним. */
export default function GuideTaskRoute({ params }: GuideTaskRouteProps) {
  return <GuideTaskPage params={params} />;
}
