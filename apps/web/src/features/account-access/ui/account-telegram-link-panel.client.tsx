"use client";

import {
  ArrowUpRight,
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Send,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

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

export function AccountTelegramLinkPanel({
  link,
  onClose,
  onRefresh,
}: {
  readonly link: AccountTelegramMembership["link"];
  readonly onClose: () => void;
  readonly onRefresh: () => Promise<void>;
}) {
  const flow = useTelegramLinkFlow(onRefresh);
  const presentation = telegramLinkPresentation(link);

  return (
    <section aria-labelledby="telegram-onboarding-heading" className="p-6 sm:p-7">
      <div className="flex items-start justify-between gap-5">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-accent/15 text-foreground ring-1 ring-inset ring-accent/20 [&_svg]:size-5">
          {presentation.onboarding.tone === "active" ? (
            <CheckCircle2 aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
        </span>
        <Button
          aria-label="Закрыть подключение Telegram"
          className="size-11 shrink-0 rounded-full"
          onClick={onClose}
          size="icon"
          type="button"
          variant="ghost"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <h2
        className="mt-6 text-balance text-2xl font-bold tracking-[-0.04em] focus:outline-none sm:text-[1.75rem]"
        id="telegram-onboarding-heading"
        style={{ outline: "none" }}
        tabIndex={-1}
      >
        {presentation.onboarding.title}
      </h2>
      <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">
        {presentation.onboarding.description}
      </p>

      {presentation.action.kind === "none" ? null : (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 [&>*:only-child]:sm:col-span-2">
          <TelegramAction action={presentation.action} flow={flow} onClose={onClose} />
        </div>
      )}
      <MutationNotice result={flow.mutationResult} />
    </section>
  );
}

function TelegramAction({
  action,
  flow,
  onClose,
}: {
  readonly action: TelegramLinkAction;
  readonly flow: TelegramLinkFlow;
  readonly onClose: () => void;
}) {
  switch (action.kind) {
    case "begin":
      return (
        <ActionButton
          icon={<Send aria-hidden="true" data-icon="inline-start" />}
          label={
            action.context === "initial"
              ? "Подключить Telegram"
              : "Попробовать снова"
          }
          onClick={() => {
            void flow.begin();
          }}
          pending={flow.pending}
        />
      );
    case "confirm":
      if (action.context === "linking" && flow.automaticConfirmation) {
        return (
          <div
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-muted px-4 text-sm font-semibold sm:col-span-2"
            role="status"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            Проверяем подключение…
          </div>
        );
      }
      return (
        <>
          {action.context === "linking" && flow.deepLink !== null ? (
            <Button asChild className="h-11 w-full rounded-xl px-4" size="lg">
              <a href={flow.deepLink} rel="noopener noreferrer" target="_blank">
                Открыть Telegram
                <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          ) : null}
          <ActionButton
            icon={<CheckCircle2 aria-hidden="true" data-icon="inline-start" />}
            label={
              action.context === "linking"
                ? "Проверить связь"
                : "Повторить проверку"
            }
            onClick={() => {
              flow.confirm(action.linkRef);
            }}
            pending={flow.pending}
            variant={flow.deepLink === null ? "default" : "outline"}
          />
        </>
      );
    case "refresh":
      return (
        <ActionButton
          label="Обновить состояние"
          onClick={flow.refresh}
          pending={flow.pending}
        />
      );
    case "support":
      return <SupportLink url={action.url} />;
    case "complete":
      return (
        <Button
          className="h-11 w-full rounded-xl px-4"
          onClick={onClose}
          size="lg"
          type="button"
        >
          Продолжить
          <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
        </Button>
      );
    case "none":
      return null;
  }
}

function ActionButton({
  icon = <RefreshCw aria-hidden="true" data-icon="inline-start" />,
  label,
  onClick,
  pending,
  variant = "default",
}: {
  readonly icon?: ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly pending: boolean;
  readonly variant?: "default" | "outline";
}) {
  return (
    <Button
      className="h-11 w-full rounded-xl px-4"
      disabled={pending}
      onClick={onClick}
      size="lg"
      type="button"
      variant={variant}
    >
      {pending ? (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
          data-icon="inline-start"
        />
      ) : (
        icon
      )}
      {label}
    </Button>
  );
}

function SupportLink({ url }: { readonly url: string }) {
  return (
    <Button asChild className="h-11 w-full rounded-xl px-4" size="lg">
      <a href={url} rel="noopener noreferrer" target="_blank">
        Написать в поддержку
        <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
      </a>
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
    <p className="mt-4 rounded-xl bg-destructive/6 px-4 py-3 text-sm" role="alert">
      {result.kind === "unauthorized"
        ? "Сессия завершилась. Войдите снова, чтобы продолжить."
        : `Не удалось выполнить действие. Текущее состояние не изменилось. Код: ${result.reference}`}
    </p>
  );
}
