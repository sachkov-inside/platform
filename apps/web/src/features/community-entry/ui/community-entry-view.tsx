import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { billingActionClass } from "@/entities/subscription";
import { Button } from "@/shared/ui/button";

import type { CommunityEntry } from "../model/community-entry";

export interface CommunityEntryViewProps {
  /** `null`, пока первое чтение не завершилось: блок не мелькает у покупки без сообщества. */
  readonly entry: CommunityEntry | null;
  readonly error?: boolean;
  /** Раздел кабинета, где Telegram подключается к аккаунту. */
  readonly telegramHref: Route;
  readonly onRetry: () => void;
}

/**
 * Temporary semantic UI for #822.
 * Replace through #824 after Storybook acceptance.
 */
/**
 * Переход в сообщество Inside рядом с покупкой. Личную ссылку в группу выдаёт только бот по
 * `/community`, поэтому кнопка ведёт в бота; адреса группы здесь нет, и участник видит статус.
 */
export function CommunityEntryView({
  entry,
  error = false,
  telegramHref,
  onRetry,
}: CommunityEntryViewProps) {
  if (error) {
    return (
      <CommunityCard>
        <p className="text-sm leading-6 text-muted-foreground" role="alert">
          Не получилось проверить вход в сообщество. Доступ к материалам от
          этого не зависит.
        </p>
        <div className="mt-4">
          <Button
            className={billingActionClass}
            onClick={onRetry}
            type="button"
            variant="outline"
          >
            Проверить снова
          </Button>
        </div>
      </CommunityCard>
    );
  }
  if (entry === null || entry.kind === "none") return null;
  switch (entry.kind) {
    case "join":
      return (
        <CommunityCard>
          <p className="text-sm leading-6 text-muted-foreground">
            Личную ссылку в группу выдаёт бот Inside. Откройте его и отправьте
            команду /community — ссылка действует несколько минут и только для
            вас.
          </p>
          <div className="mt-4">
            <Button asChild className={billingActionClass}>
              <a href={entry.botUrl} rel="noopener noreferrer" target="_blank">
                Вступить в сообщество
              </a>
            </Button>
          </div>
        </CommunityCard>
      );
    case "link_telegram":
      return (
        <CommunityCard>
          <p className="text-sm leading-6 text-muted-foreground">
            В группу приглашает бот Inside. Подключите Telegram к аккаунту — бот
            сразу пришлёт личную ссылку для вступления.
          </p>
          <div className="mt-4">
            <Button asChild className={billingActionClass}>
              <Link href={telegramHref}>Подключить Telegram</Link>
            </Button>
          </div>
        </CommunityCard>
      );
    case "preparing":
      return (
        <CommunityCard>
          <p className="text-sm leading-6 text-muted-foreground" role="status">
            Готовим вход в сообщество. Обычно это занимает меньше минуты — блок
            обновится сам.
          </p>
        </CommunityCard>
      );
    case "member":
      return (
        <CommunityCard>
          <p className="text-sm leading-6 text-muted-foreground">
            Вы уже в сообществе Inside — группа есть в вашем Telegram.
          </p>
        </CommunityCard>
      );
    case "restricted":
      return (
        <CommunityCard>
          <p className="text-sm leading-6 text-muted-foreground">
            Вступление в сообщество сейчас ограничено. Доступ к материалам
            сохраняется; если это ошибка, напишите в поддержку.
          </p>
        </CommunityCard>
      );
  }
}

function CommunityCard({ children }: { readonly children: ReactNode }) {
  return (
    <section
      aria-labelledby="community-entry-title"
      className="rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <h2 className="text-lg font-semibold" id="community-entry-title">
        Сообщество Inside
      </h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
