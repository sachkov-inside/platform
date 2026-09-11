"use client";
import {
  AccountTelegramPanel,
  type AccountTelegramMembership,
} from "@/features/account-access";
import { Button } from "@/shared/ui/button";
import { AccountSectionHeader } from "@/widgets/account-cabinet";

export interface AccountAccessViewProps {
  readonly link: AccountTelegramMembership["link"] | null;
  readonly loading?: boolean;
  readonly refreshing?: boolean;
  readonly sessionExpired?: boolean;
  readonly onTelegramRefresh: () => Promise<void>;
  readonly onReload: () => void;
}

/**
 * Раздел «Аккаунт»: связь с Telegram и выход. Что открыто и до какого срока объясняет раздел
 * «Покупки» — здесь этот вопрос не решается.
 */
export function AccountAccessView({
  link,
  loading = false,
  refreshing = false,
  sessionExpired = false,
  onTelegramRefresh,
  onReload,
}: AccountAccessViewProps) {
  return (
    <div>
      <AccountSectionHeader section="access" />
      {loading ? (
        <p className="text-sm text-muted-foreground" role="status">
          Загружаем состояние аккаунта…
        </p>
      ) : sessionExpired ? (
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
      ) : link === null ? (
        <div
          className="rounded-2xl border border-border bg-card p-6 shadow-card"
          role="alert"
        >
          <p className="text-sm leading-6">
            Состояние аккаунта сейчас недоступно. Данные не менялись.
          </p>
          <Button
            className="mt-4 min-h-11 px-4"
            disabled={refreshing}
            onClick={onReload}
            type="button"
            variant="outline"
          >
            Обновить данные
          </Button>
        </div>
      ) : (
        <div className="grid gap-6">
          <AccountTelegramPanel link={link} onRefresh={onTelegramRefresh} />
          <div className="flex flex-wrap gap-2">
            <Button
              className="min-h-11 px-4"
              disabled={refreshing}
              onClick={onReload}
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
