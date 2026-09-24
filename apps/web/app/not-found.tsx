import { PublicShell } from "@/_app";
import { PageNotFound } from "@/_pages/route-states";

/** Неизвестный адрес. Корневая страница стоит вне публичной раскладки, поэтому надевает оболочку сама. */
export default function NotFound() {
  return (
    <PublicShell>
      <title>Страница не найдена · Sachkov Inside</title>
      <PageNotFound />
    </PublicShell>
  );
}
