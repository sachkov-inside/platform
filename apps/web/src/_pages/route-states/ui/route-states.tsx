import { ArrowLeft, CloudOff, RefreshCw, SearchX, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import { Button } from "@/shared/ui/button";
import { StatusPanel } from "@/shared/ui/status-panel";

/**
 * Адреса нет на площадке или документ по нему больше не открывается. Главная — она же каталог,
 * поэтому возврат один.
 */
export function PageNotFound() {
  return (
    <>
      <title>Страница не найдена · Sachkov Inside</title>
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
    </>
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

/**
 * Сбой, когда оболочки уже нет: упала раскладка раздела или корневая. Состояние стоит посреди
 * пустого экрана.
 */
export function StandalonePageError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <main className="grid min-h-svh place-items-center bg-background px-5 py-12 text-foreground">
      <PageUnexpectedError onRetry={onRetry} />
    </main>
  );
}

/** Сбой авторского раздела: авторская оболочка остаётся, код обращения помогает найти запись в журнале. */
export function AuthoringUnexpectedError({
  digest,
  onRetry,
}: {
  readonly digest: string | undefined;
  readonly onRetry: () => void;
}) {
  return (
    <main
      className="grid h-full min-h-svh place-items-center bg-background px-5 py-12 text-foreground md:min-h-0"
      id="authoring-content"
      tabIndex={-1}
    >
      <section
        aria-labelledby="material-authoring-error-heading"
        className="w-full max-w-xl border-y border-border py-10 text-center"
        role="alert"
      >
        <CloudOff aria-hidden="true" className="mx-auto size-8 text-destructive" />
        <h1
          className="mt-5 text-2xl font-semibold tracking-[-0.025em]"
          id="material-authoring-error-heading"
        >
          Редактор остановлен
        </h1>
        <p className="mx-auto mt-3 max-w-[52ch] text-sm leading-6 text-muted-foreground">
          Произошла непредвиденная ошибка. Повторите действие или вернитесь к материалам.
        </p>
        <p className="mt-3 font-mono text-[0.6875rem] text-muted-foreground">
          Код обращения: {digest ?? "authoring-boundary"}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button onClick={onRetry} type="button">Повторить</Button>
          <Button asChild variant="outline">
            <Link href={authoringMaterialsRootHref}>Вернуться к материалам</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
