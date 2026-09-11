"use client";
import { useQuery } from "@tanstack/react-query";

import {
  accountPresentationBrowserQueryOptions,
  AccountTelegramPanel,
} from "@/features/account-access";
import { Button } from "@/shared/ui/button";

/**
 * Раздел «Аккаунт»: связь с Telegram и выход. Что открыто и до какого срока объясняет раздел
 * «Покупки» — здесь этот вопрос не решается.
 */
export function AccountAccessPage() {
  const query = useQuery(accountPresentationBrowserQueryOptions());
  const presentation =
    query.data?.kind === "ready" ? query.data.presentation : null;

  return (
    <div>
      <header className="mb-8 border-b border-border pb-7">
        <h1 className="text-balance text-4xl font-bold tracking-[-0.04em] sm:text-5xl">
          Аккаунт
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Связь с Telegram и выход из аккаунта на этом устройстве.
        </p>
      </header>

      {query.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          Загружаем состояние аккаунта…
        </p>
      ) : query.data?.kind === "unauthorized" ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card">
          <p className="text-sm leading-6">
            Войдите, чтобы управлять связью с Telegram.
          </p>
          <form action="/auth/sign-in" className="mt-4" method="post">
            <input name="returnTo" type="hidden" value="/account/access" />
            <Button className="min-h-11 px-4" type="submit">
              Войти
            </Button>
          </form>
        </div>
      ) : presentation === null ? (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-card" role="alert">
          <p className="text-sm leading-6">
            Состояние аккаунта сейчас недоступно. Данные не менялись.
          </p>
          <Button
            className="mt-4 min-h-11 px-4"
            onClick={() => {
              void query.refetch();
            }}
            type="button"
            variant="outline"
          >
            Обновить данные
          </Button>
        </div>
      ) : (
        <div className="grid gap-6">
          <AccountTelegramPanel
            link={presentation.telegramMembership.link}
            onRefresh={() => query.refetch().then(() => undefined)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11 px-4"
              disabled={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
              type="button"
              variant="outline"
            >
              Обновить данные
            </Button>
          </div>
          <section
            aria-labelledby="account-session"
            className="rounded-2xl border border-border bg-card p-6 shadow-card"
          >
            <h2 className="text-xl font-semibold" id="account-session">
              Выход
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Выход завершает сессию в этом браузере. Права доступа и покупки
              остаются на месте.
            </p>
            <form action="/auth/sign-out" className="mt-4" method="post">
              <Button className="min-h-11 px-4" type="submit" variant="outline">
                Выйти из аккаунта
              </Button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
