"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
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

export function AccountMembershipPanel({
  onRefresh,
  presentation,
}: {
  readonly onRefresh: () => Promise<void>;
  readonly presentation: AccountTelegramMembership;
}) {
  const flow = useTelegramLinkFlow(onRefresh);

  return (
    <section
      aria-labelledby="inside-access-heading"
      className="mb-10 grid gap-4"
    >
      <h2 className="sr-only" id="inside-access-heading">
        Telegram и доступ к Sachkov Inside
      </h2>
      <TelegramConnection state={presentation.link} {...flow} />
      <InsideAccessCard
        pending={flow.pending}
        refresh={flow.refresh}
        state={presentation.membership}
      />
      <MutationNotice result={flow.mutationResult} />
    </section>
  );
}

function TelegramConnection({
  state,
  ...flow
}: TelegramActionFlow & {
  readonly state: AccountTelegramMembership["link"];
}) {
  const presentation = telegramLinkPresentation(state);
  const linked = state.kind === "linked";

  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-[#229ED9]/25 bg-[#229ED9]/[0.08] p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="flex min-w-0 items-start gap-4 sm:items-center">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#229ED9] text-white shadow-sm [&_svg]:size-5">
          {linked ? (
            <Check aria-hidden="true" strokeWidth={2.5} />
          ) : (
            <Send aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#075985]">
            Telegram
          </p>
          <h3 className="mt-1 text-lg font-bold tracking-[-0.025em]">
            {presentation.account.title}
          </h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            {presentation.account.description}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
        {telegramAction(presentation.action, flow)}
      </div>
    </article>
  );
}

function InsideAccessCard({
  pending,
  refresh,
  state,
}: {
  readonly pending: boolean;
  readonly refresh: () => void;
  readonly state: AccountTelegramMembership["membership"];
}) {
  const view = accessView(state, { pending, refresh });

  return (
    <article className="relative overflow-hidden rounded-[1.75rem] border border-accent/25 bg-card p-6 shadow-sm sm:p-7">
      <span
        aria-hidden="true"
        className="absolute -right-16 -top-20 size-56 rounded-full bg-accent/15 blur-3xl"
      />
      <div className="relative flex flex-col gap-7 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent/15 text-accent ring-1 ring-inset ring-accent/20 [&_svg]:size-5">
            <Sparkles aria-hidden="true" />
          </span>
          <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-[#9A3412]">
            {view.label}
          </p>
          <h3 className="mt-2 text-2xl font-bold tracking-[-0.035em] sm:text-[1.75rem]">
            Доступ к Sachkov Inside
          </h3>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
            {view.description}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-3">{view.action}</div>
      </div>
    </article>
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

function telegramAction(action: TelegramLinkAction, flow: TelegramActionFlow) {
  switch (action.kind) {
    case "begin":
      return (
        <TelegramButton
          label={
            action.context === "initial" ? "Подключить" : "Попробовать снова"
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
              className="h-10 rounded-xl border-[#229ED9]/30 bg-background/70 px-4 text-[#075985] hover:bg-background"
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
        <Button
          asChild
          className="h-10 rounded-xl bg-[#0369A1] px-4 text-white hover:bg-[#075985]"
          size="lg"
        >
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
      className={
        secondary
          ? "h-10 rounded-xl border-[#229ED9]/30 bg-background/70 px-4 text-[#075985] hover:bg-background"
          : "h-10 rounded-xl bg-[#0369A1] px-4 text-white hover:bg-[#075985]"
      }
      disabled={pending}
      onClick={onClick}
      size="lg"
      type="button"
      variant={secondary ? "outline" : "default"}
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

function accessView(
  state: AccountTelegramMembership["membership"],
  actions: { readonly pending: boolean; readonly refresh: () => void },
): {
  readonly action: ReactNode;
  readonly description: string;
  readonly label: string;
} {
  switch (state.kind) {
    case "active":
      return {
        action: (
          <Button asChild className="h-11 rounded-xl px-5" size="lg">
            <Link href="/library">
              Перейти к материалам
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
          </Button>
        ),
        description:
          "Подписка активна — вам открыты закрытые материалы, разборы и обновления платформы.",
        label: "Всё открыто",
      };
    case "inactive":
      return {
        action: (
          <Button
            asChild
            className="h-11 rounded-xl bg-[#b83a1d] px-5 text-white hover:bg-[#8f2c16]"
            size="lg"
          >
            <a
              href={state.acquisitionUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Получить доступ
              <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
            </a>
          </Button>
        ),
        description:
          "Откройте полную базу знаний, закрытые материалы и новые практические разборы.",
        label: "Подписка Inside",
      };
    case "stale":
      return {
        action: (
          <AccessRefreshButton
            label="Обновить доступ"
            onClick={actions.refresh}
            pending={actions.pending}
          />
        ),
        description:
          "Обновим статус подписки и сразу покажем доступные вам материалы.",
        label: "Проверяем подписку",
      };
    case "unavailable":
      return {
        action: (
          <AccessRefreshButton
            label="Обновить доступ"
            onClick={actions.refresh}
            pending={actions.pending}
          />
        ),
        description:
          "Все материалы Inside остаются здесь. Обновите статус, чтобы увидеть возможности вашей подписки.",
        label: "Подписка Inside",
      };
  }
}

function AccessRefreshButton({
  label,
  onClick,
  pending,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly pending: boolean;
}) {
  return (
    <Button
      className="h-11 rounded-xl px-5"
      disabled={pending}
      onClick={onClick}
      size="lg"
      type="button"
    >
      {pending ? (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
          data-icon="inline-start"
        />
      ) : (
        <RefreshCw aria-hidden="true" data-icon="inline-start" />
      )}
      {label}
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
