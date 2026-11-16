import type { Metadata } from "next";

import { PublicShell } from "@/_app";
import { PageNotFound, pageNotFoundTitle } from "@/_pages/route-states";

/**
 * Документ неизвестного адреса получает тот же заголовок, что ставит `<title>` в `PageNotFound`.
 * Без этого в документе стоял бы и заголовок раскладки по умолчанию, а вкладку называл бы тот из
 * двух, чей компонент гидрировался последним (#2213). `<title>` в `PageNotFound` остаётся для
 * `notFound()` из страниц `/authoring`, которые показывает этот же файл: без него их вкладка
 * называлась бы по странице, и это ловит тест `/authoring` в `test/e2e/routes.spec.ts`.
 */
export const metadata: Metadata = { title: pageNotFoundTitle };

/** Неизвестный адрес. Корневая страница стоит вне публичной раскладки, поэтому надевает оболочку сама. */
export default function NotFound() {
  return (
    <PublicShell>
      <PageNotFound />
    </PublicShell>
  );
}
