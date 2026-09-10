import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/shared/ui/button";

export function BookmarksPage({ children }: { readonly children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6" data-bookmarks-page>
      <header>
        <h1 className="text-3xl font-bold tracking-[-0.03em]">Закладки</h1>
        <p className="mt-3 text-muted-foreground">
          Материалы, которые вы сохранили, чтобы вернуться к ним позже.
        </p>
      </header>
      <div className="mt-8">{children}</div>
    </main>
  );
}

export function BookmarksLoading() {
  return (
    <section aria-busy="true" className="grid gap-3">
      <p className="sr-only" role="status">Загружаем закладки…</p>
      <div className="h-24 animate-pulse rounded-2xl border border-border bg-muted/50 motion-reduce:animate-none" />
      <div className="h-24 animate-pulse rounded-2xl border border-border bg-muted/50 motion-reduce:animate-none" />
    </section>
  );
}

export function BookmarksEmpty() {
  return (
    <section className="py-12">
      <h2 className="text-lg font-semibold">Пока пусто</h2>
      <p className="mt-2 text-muted-foreground">
        Сохраняйте материалы кнопкой «В закладки», и они появятся здесь.
      </p>
      <Button asChild className="mt-6" variant="outline">
        <Link href="/library">Открыть Базу знаний</Link>
      </Button>
    </section>
  );
}

export function BookmarksSignInRequired() {
  return (
    <section className="py-12">
      <h2 className="text-lg font-semibold">Войдите в аккаунт</h2>
      <p className="mt-2 text-muted-foreground">
        Закладки хранятся в аккаунте и доступны только вам.
      </p>
      <form action="/auth/sign-in" className="mt-6" method="post">
        <button className="min-h-11 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground" type="submit">
          Войти
        </button>
      </form>
    </section>
  );
}

export function BookmarksUnavailable() {
  return (
    <section className="py-12" role="alert">
      <h2 className="text-lg font-semibold">Закладки временно недоступны</h2>
      <p className="mt-2 text-muted-foreground">
        Данные не потеряны. Обновите страницу или повторите попытку позже.
      </p>
    </section>
  );
}
