import { ArrowLeft, RefreshCw, SearchX, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Button } from "@/shared/ui/button";
import { StatusPanel } from "@/shared/ui/status-panel";

/**
 * Адреса нет на площадке или документ по нему больше не открывается. Главная — она же каталог,
 * поэтому возврат один.
 */
export function PageNotFound() {
  return (
    <StatusPanel
      action={
        <Button asChild size="lg">
          <Link href="/">
            <ArrowLeft aria-hidden="true" />
            На главную
          </Link>
        </Button>
      }
      icon={<SearchX aria-hidden="true" />}
      message="Проверьте адрес или откройте Главную: там все материалы, темы и продукты."
      state={{ "data-route-state": "not-found" }}
      title="Страница не найдена"
    />
  );
}

/**
 * Непредвиденный сбой страницы. Повтор перечитывает её с сервера: повторная отрисовка без запроса
 * показала бы тот же сбой.
 */
export function PageUnexpectedError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <StatusPanel
      action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={onRetry} size="lg">
            <RefreshCw aria-hidden="true" />
            Повторить
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/">На главную</Link>
          </Button>
        </div>
      }
      icon={<ShieldAlert aria-hidden="true" />}
      message="Не удалось показать страницу. Попробуйте ещё раз или вернитесь на Главную."
      state={{ "data-route-state": "unexpected-error" }}
      title="Страница сейчас недоступна"
    />
  );
}
