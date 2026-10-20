"use client";

import {
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  LoaderCircle,
} from "lucide-react";

import { Button } from "@/shared/ui/button";

import type {
  AccountTelegramMembership,
  TelegramLinkMutationResult,
} from "../model/account-telegram-membership";
import {
  type TelegramLinkFlow,
  useTelegramLinkFlow,
} from "../model/use-telegram-link-flow.client";
import {
  type TelegramLinkAction,
  telegramLinkPresentation,
} from "./telegram-link-presentation";

/**
 * Связь Account с Telegram. Права доступа и их сроки показывает раздел «Покупки»: одно
 * основание объясняется в одном месте.
 */
export function AccountTelegramPanel({
  link,
  onRefresh,
  contact,
  retryLabel = "Попробовать снова",
}: {
  readonly link: AccountTelegramMembership["link"];
  readonly contact?: AccountTelegramMembership["contact"];
  readonly onRefresh: () => Promise<void>;
  readonly retryLabel?: string;
}) {
  const flow = useTelegramLinkFlow(onRefresh);
  const presentation = telegramLinkPresentation(link);

  return (
    <section
      aria-labelledby="telegram-connection-heading"
      className="grid gap-3"
    >
      <h3 className="text-base font-semibold" id="telegram-connection-heading">
        Telegram
      </h3>
      <article className="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="min-w-0 [overflow-wrap:anywhere]">
            <p className="text-sm font-medium">{presentation.account.title}</p>
            {contact?.state === "available" ? (
              <p className="mt-2 break-words text-sm">
                {contact.displayName}
                {contact.username === null ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · Username не задан
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {" "}
                    · @{contact.username}
                  </span>
                )}
              </p>
            ) : contact?.state === "unavailable" ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Не удалось загрузить имя и username из Telegram.
              </p>
            ) : null}
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
              {presentation.account.description}
            </p>
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">
          {telegramAction(presentation.action, flow, retryLabel)}
        </div>
      </article>
      <MutationNotice result={flow.mutationResult} />
    </section>
  );
}

type TelegramActionFlow = Pick<
  TelegramLinkFlow,
  | "automaticConfirmation"
  | "begin"
  | "confirm"
  | "deepLink"
  | "pending"
  | "refresh"
>;

function telegramAction(
  action: TelegramLinkAction,
  flow: TelegramActionFlow,
  retryLabel: string,
) {
  switch (action.kind) {
    case "begin":
      return (
        <TelegramButton
          label={action.context === "initial" ? "Подключить" : retryLabel}
          onClick={() => {
            void flow.begin();
          }}
          pending={flow.pending}
        />
      );
    case "confirm":
      if (action.context === "linking" && flow.automaticConfirmation) {
        return (
          <p
            className="flex h-10 items-center gap-2 rounded-xl bg-background/70 px-4 text-sm font-semibold"
            role="status"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            Проверяем подключение…
          </p>
        );
      }
      return (
        <>
          {action.context === "linking" && flow.deepLink !== null ? (
            <Button
              asChild
              className="min-h-11 px-4"
              size="lg"
              variant="outline"
            >
              <a href={flow.deepLink} rel="noopener noreferrer" target="_blank">
                Открыть Telegram
                <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          ) : null}
          <TelegramButton
            label={
              action.context === "linking"
                ? "Проверить подключение"
                : "Повторить проверку"
            }
            onClick={() => {
              flow.confirm(action.linkRef);
            }}
            pending={flow.pending}
            secondary={flow.deepLink !== null}
          />
        </>
      );
    case "refresh":
      return (
        <TelegramButton
          label="Обновить"
          onClick={flow.refresh}
          pending={flow.pending}
        />
      );
    case "support":
      return (
        <Button asChild className="min-h-11 px-4" size="lg" variant="outline">
          <a href={action.url} rel="noopener noreferrer" target="_blank">
            Написать в поддержку
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </a>
        </Button>
      );
    case "complete":
    case "none":
      return null;
  }
}

function TelegramButton({
  label,
  onClick,
  pending,
  secondary = false,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly pending: boolean;
  readonly secondary?: boolean;
}) {
  return (
    <Button
      className="min-h-11 px-4"
      disabled={pending}
      onClick={onClick}
      size="lg"
      type="button"
      variant={secondary ? "ghost" : "outline"}
    >
      {label}
      {pending ? (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
          data-icon="inline-end"
        />
      ) : (
        <ArrowRight aria-hidden="true" data-icon="inline-end" />
      )}
    </Button>
  );
}

function MutationNotice({
  result,
}: {
  readonly result: TelegramLinkMutationResult | null;
}) {
  if (result === null || result.kind === "received") return null;
  return (
    <p
      className="flex items-start gap-2 rounded-xl bg-destructive/6 px-4 py-3 text-sm"
      role="alert"
    >
      <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {result.kind === "unauthorized"
        ? "Сессия завершилась. Войдите снова, чтобы продолжить."
        : `Не удалось выполнить действие. Текущее состояние не изменилось. Код: ${result.reference}`}
    </p>
  );
}
