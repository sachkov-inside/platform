import type { Metadata } from "next";

import { PublicShell } from "@/_app";
import { PageNotFound } from "@/_pages/route-states";

/**
 * Документ неизвестного адреса называется так же, как `<title>` внутри `PageNotFound`. Без этого
 * в нём стоял бы ещё и заголовок раскладки по умолчанию, а вкладку называл бы тот из двух, чей
 * компонент гидрировался последним (#2213). `<title>` в разметке остаётся для `notFound()` из
 * уже начатого ответа: там метаданные принадлежат странице и сюда не доходят.
 */
export const metadata: Metadata = { title: "Страница не найдена" };

/** Неизвестный адрес. Корневая страница стоит вне публичной раскладки, поэтому надевает оболочку сама. */
export default function NotFound() {
  return (
    <PublicShell>
      <PageNotFound />
    </PublicShell>
  );
}
