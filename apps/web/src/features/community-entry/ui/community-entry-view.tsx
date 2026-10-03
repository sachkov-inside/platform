import type { Route } from "next";
import Link from "next/link";
import {
  Check,
  CircleCheck,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { billingActionClass } from "@/entities/subscription";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import type { CommunityEntry } from "../model/community-entry";

export interface CommunityEntryViewProps {
  /** `null`, пока первое чтение не завершилось: блок не мелькает у покупки без сообщества. */
  readonly entry: CommunityEntry | null;
  readonly error?: boolean;
  /** Раздел кабинета, где Telegram подключается к аккаунту. */
  readonly telegramHref: Route;
}

/** Состояния, в которых путь в группу ещё идёт или уже пройден. */
type PathEntry = Extract<
  CommunityEntry,
  { kind: "link_telegram" | "preparing" | "join" | "member" }
>;

/** Сколько шагов пути пройдено в каждом состоянии; у участника пройдены все три. */
const passedSteps = {
  link_telegram: 0,
  preparing: 1,
  join: 1,
  member: 3,
} as const satisfies Record<PathEntry["kind"], number>;

/** Кнопки блока одной ширины отступов: обе ведут к следующему шагу пути. */
const pathActionClass = cn(billingActionClass, "px-4");

/**
 * Что вспомогательные технологии объявляют при смене состояния. Объявление живёт в карточке, а не
 * в шаге: так переход «готовим вход» → «ссылка готова» слышен, хотя сам шаг перерисовывается.
 */
const announcements = {
  link_telegram: "",
  preparing: "Готовим вход в сообщество.",
  join: "Ссылка в сообщество готова.",
  member: "Вы участник сообщества Inside.",
} as const satisfies Record<PathEntry["kind"], string>;

/**
 * Переход в сообщество Inside рядом с покупкой. Личную ссылку в группу выдаёт только бот по
 * `/community`, поэтому путь показан тремя шагами: Telegram, ссылка от бота, группа. Адреса
 * группы здесь нет, и участник видит пройденный путь без кнопки.
 */
export function CommunityEntryView({
  entry,
  error = false,
  telegramHref,
}: CommunityEntryViewProps) {
  if (error) {
    return (
      <CommunityCard announcement="Не получилось проверить вход в сообщество.">
        <Notice icon={<RefreshCw />}>
          Не получилось проверить вход в сообщество — повторим автоматически.
          Доступ к материалам от этого не зависит.
        </Notice>
      </CommunityCard>
    );
  }
  if (entry === null || entry.kind === "none") return null;
  if (entry.kind === "restricted") {
    return (
      <CommunityCard announcement="Вступление в сообщество ограничено.">
        <Notice icon={<ShieldAlert className="text-(--callout-warning)" />}>
          Вступление в сообщество сейчас ограничено. Доступ к материалам
          сохраняется; если это ошибка, напишите в поддержку.
        </Notice>
      </CommunityCard>
    );
  }
  return (
    <CommunityCard announcement={announcements[entry.kind]}>
      <EntryPath entry={entry} />
      <PathAction entry={entry} telegramHref={telegramHref} />
    </CommunityCard>
  );
}

function EntryPath({ entry }: { readonly entry: PathEntry }) {
  const passed = passedSteps[entry.kind];
  const preparing = entry.kind === "preparing";
  const steps = [
    {
      key: "telegram",
      title: "Подключить Telegram",
      hint: "Бот узнаёт вас по аккаунту Inside.",
    },
    {
      key: "bot_link",
      title: "Получить ссылку у бота",
      hint: preparing
        ? "Готовим вход в сообщество — обычно меньше минуты, блок обновится сам."
        : "Бот выдаёт личную ссылку по /community.",
    },
    {
      key: "group",
      title: "Вступить в группу",
      hint: "Группа появится в вашем Telegram.",
    },
  ] as const;
  return (
    <ol className="mt-6 grid gap-4 sm:grid-cols-3 sm:gap-3">
      {steps.map((step, index) => {
        const state =
          index < passed ? "passed" : index === passed ? "current" : "ahead";
        const waiting = state === "current" && preparing;
        return (
          <li
            aria-current={state === "current" ? "step" : undefined}
            className={cn(
              "flex gap-3 sm:flex-col sm:gap-2 sm:border-t-2 sm:pt-3",
              state === "passed" && "sm:border-foreground",
              state === "current" && "sm:border-action",
              state === "ahead" && "sm:border-border",
            )}
            data-step={step.key}
            key={step.key}
          >
            <span
              aria-hidden="true"
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold [&_svg]:size-4",
                state === "passed" && "bg-foreground text-background",
                state === "current" &&
                  "bg-action text-accent-foreground ring-4 ring-accent/15",
                state === "ahead" &&
                  "border border-border text-muted-foreground",
              )}
            >
              {state === "passed" ? (
                <Check />
              ) : waiting ? (
                <LoaderCircle className="animate-spin motion-reduce:animate-none" />
              ) : (
                index + 1
              )}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  "text-sm font-semibold",
                  state === "ahead" && "text-muted-foreground",
                )}
              >
                {step.title}
                {state === "passed" ? (
                  <span className="sr-only"> — готово</span>
                ) : null}
              </p>
              <p className="mt-0.5 text-sm leading-5 text-muted-foreground">
                {step.hint}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PathAction({
  entry,
  telegramHref,
}: {
  readonly entry: PathEntry;
  readonly telegramHref: Route;
}) {
  switch (entry.kind) {
    case "join":
      return (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button asChild className={pathActionClass}>
            <a href={entry.botUrl} rel="noopener noreferrer" target="_blank">
              <Send aria-hidden="true" />
              Вступить в сообщество
            </a>
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Ссылка действует несколько минут и только для вас.
          </p>
        </div>
      );
    case "link_telegram":
      return (
        <div className="mt-6">
          <Button asChild className={pathActionClass}>
            <Link href={telegramHref}>Подключить Telegram</Link>
          </Button>
        </div>
      );
    case "member":
      // Сюда встанет «Открыть группу», когда Platform узнает адрес группы (#823).
      return (
        <p className="mt-6 flex items-center gap-2 text-sm font-semibold">
          <CircleCheck aria-hidden="true" className="size-4 shrink-0" />
          Вы уже в сообществе Inside — группа есть в вашем Telegram.
        </p>
      );
    case "preparing":
      return null;
  }
}

/** Ограничение и сбой не продвигают путь: шаги заменяет одна спокойная строка. */
function Notice({
  children,
  icon,
}: {
  readonly children: ReactNode;
  readonly icon: ReactNode;
}) {
  return (
    <p className="mt-5 flex gap-3 rounded-xl bg-muted p-4 text-sm leading-6">
      <span
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-5"
      >
        {icon}
      </span>
      <span>{children}</span>
    </p>
  );
}

function CommunityCard({
  announcement = "",
  children,
}: {
  readonly announcement?: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby="community-entry-title"
      className="rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/12 text-action [&_svg]:size-5">
          <UsersRound aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold" id="community-entry-title">
            Сообщество Inside
          </h2>
          <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
            Общий чат участников Inside в Telegram.
          </p>
        </div>
      </div>
      {children}
      <p className="sr-only" role="status">
        {announcement}
      </p>
    </section>
  );
}
