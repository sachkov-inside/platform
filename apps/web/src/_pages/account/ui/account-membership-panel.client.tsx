"use client";

import {
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  Link2,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

import { Button } from "@/shared/ui/button";

import { beginTelegramLink } from "../api/begin-telegram-link.browser";
import { confirmTelegramLink } from "../api/confirm-telegram-link.browser";
import type {
  AccountTelegramMembership,
  TelegramLinkMutationResult,
} from "../model/account-telegram-membership";

export function AccountMembershipPanel({
  onRefresh,
  presentation,
}: {
  readonly onRefresh: () => Promise<void>;
  readonly presentation: AccountTelegramMembership;
}) {
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const beginMutation = useMutation({
    mutationFn: beginTelegramLink,
    onSuccess: async (result) => {
      if (result.kind === "received" && result.state.deepLink !== undefined) {
        setDeepLink(result.state.deepLink);
      }
      await onRefresh();
    },
  });
  const confirmMutation = useMutation({
    mutationFn: confirmTelegramLink,
    onSuccess: async (result) => {
      if (result.kind === "received" && result.state.status !== "pending") {
        setDeepLink(null);
      }
      await onRefresh();
    },
  });
  const refreshMutation = useMutation({ mutationFn: onRefresh });
  const mutationResult = confirmMutation.data ?? beginMutation.data ?? null;
  const pending =
    beginMutation.isPending ||
    confirmMutation.isPending ||
    refreshMutation.isPending;

  const begin = () => {
    beginMutation.reset();
    confirmMutation.reset();
    beginMutation.mutate();
  };
  const confirm = (linkRef: string) => {
    beginMutation.reset();
    confirmMutation.reset();
    confirmMutation.mutate(linkRef);
  };
  const refresh = () => {
    beginMutation.reset();
    confirmMutation.reset();
    refreshMutation.mutate();
  };

  return (
    <section
      aria-labelledby="inside-access-heading"
      className="mb-10 overflow-hidden rounded-2xl border border-border bg-muted/25 shadow-sm"
    >
      <div className="border-b border-border px-5 py-5 sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
          Private Account
        </p>
        <h2
          className="mt-2 text-2xl font-bold tracking-[-0.035em]"
          id="inside-access-heading"
        >
          Доступ Inside
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Связь с Telegram подтверждает identity, а доступ к закрытым материалам
          определяется текущим Membership отдельно.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-border">
        <TelegramState
          begin={begin}
          confirm={confirm}
          deepLink={deepLink}
          pending={pending}
          refresh={refresh}
          state={presentation.link}
        />
        <MembershipState
          pending={pending}
          refresh={refresh}
          state={presentation.membership}
        />
      </div>

      <MutationNotice result={mutationResult} />
    </section>
  );
}

function TelegramState({
  begin,
  confirm,
  deepLink,
  pending,
  refresh,
  state,
}: {
  readonly begin: () => void;
  readonly confirm: (linkRef: string) => void;
  readonly deepLink: string | null;
  readonly pending: boolean;
  readonly refresh: () => void;
  readonly state: AccountTelegramMembership["link"];
}) {
  const view = telegramView(state, {
    begin,
    confirm,
    deepLink,
    pending,
    refresh,
  });
  return (
    <article className="border-b border-border p-5 lg:border-b-0 lg:p-7">
      <StateHeading icon={<Send aria-hidden="true" />} label="Telegram" />
      <p className="mt-5 flex items-center gap-2 font-semibold">
        <StatusIcon kind={view.content.tone} />
        {view.content.title}
      </p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {view.content.description}
      </p>
      {view.actions === null ? null : (
        <div className="mt-5 flex flex-wrap gap-3">{view.actions}</div>
      )}
    </article>
  );
}

function UnavailableLinkAction({
  confirm,
  pending,
  refresh,
  retry,
}: {
  readonly confirm: (linkRef: string) => void;
  readonly pending: boolean;
  readonly refresh: () => void;
  readonly retry: Extract<
    AccountTelegramMembership["link"],
    { kind: "unavailable" }
  >["retry"];
}) {
  if (retry.kind === "confirm") {
    const linkRef = retry.linkRef;
    return (
      <ActionButton
        label="Повторить проверку"
        onClick={() => {
          confirm(linkRef);
        }}
        pending={pending}
      />
    );
  }
  return (
    <ActionButton
      label="Обновить состояние"
      onClick={refresh}
      pending={pending}
    />
  );
}

function MembershipState({
  pending,
  refresh,
  state,
}: {
  readonly pending: boolean;
  readonly refresh: () => void;
  readonly state: AccountTelegramMembership["membership"];
}) {
  const view = membershipView(state, { pending, refresh });
  return (
    <article className="p-5 lg:p-7">
      <StateHeading
        icon={<ShieldCheck aria-hidden="true" />}
        label="Материалы Membership"
      />
      <p className="mt-5 flex items-center gap-2 font-semibold">
        <StatusIcon kind={view.content.tone} />
        {view.content.title}
      </p>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
        {view.content.description}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">{view.actions}</div>
    </article>
  );
}

function StateHeading({
  icon,
  label,
}: {
  readonly icon: ReactNode;
  readonly label: string;
}) {
  return (
    <h3 className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
      <span className="grid size-9 place-items-center rounded-xl bg-background text-foreground shadow-sm [&_svg]:size-4">
        {icon}
      </span>
      {label}
    </h3>
  );
}

function ActionButton({
  label,
  onClick,
  pending,
  variant = "default",
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly pending: boolean;
  readonly variant?: "default" | "outline";
}) {
  return (
    <Button
      className="h-11 rounded-xl px-4"
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
        <RefreshCw aria-hidden="true" data-icon="inline-start" />
      )}
      {label}
    </Button>
  );
}

function SupportLink({ url }: { readonly url: string }) {
  return (
    <Button asChild className="h-11 rounded-xl px-4" size="lg">
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
    <p
      className="border-t border-border bg-destructive/6 px-5 py-4 text-sm sm:px-7"
      role="alert"
    >
      {result.kind === "unauthorized"
        ? "Сессия завершилась. Войдите снова, чтобы продолжить."
        : `Не удалось выполнить действие. Текущее состояние не изменилось. Код: ${result.reference}`}
    </p>
  );
}

function StatusIcon({
  kind,
}: {
  readonly kind: "active" | "pending" | "warning";
}) {
  const className =
    kind === "active"
      ? "size-5 text-foreground"
      : kind === "pending"
        ? "size-5 text-muted-foreground"
        : "size-5 text-destructive";
  return kind === "active" ? (
    <CheckCircle2 aria-hidden="true" className={className} />
  ) : kind === "pending" ? (
    <Link2 aria-hidden="true" className={className} />
  ) : (
    <CircleAlert aria-hidden="true" className={className} />
  );
}

function telegramView(
  state: AccountTelegramMembership["link"],
  actions: {
    readonly begin: () => void;
    readonly confirm: (linkRef: string) => void;
    readonly deepLink: string | null;
    readonly pending: boolean;
    readonly refresh: () => void;
  },
): { readonly actions: ReactNode; readonly content: StateContent } {
  switch (state.kind) {
    case "unlinked":
      return {
        actions: (
          <ActionButton
            label="Связать Telegram"
            onClick={actions.begin}
            pending={actions.pending}
          />
        ),
        content: {
          description:
            "Свяжите Account с Telegram, чтобы Platform могла получить ваш Membership state. Сама связь не открывает материалы.",
          title: "Telegram не связан",
          tone: "pending",
        },
      };
    case "linking":
      return {
        actions: (
          <>
            {actions.deepLink === null ? null : (
              <Button asChild className="h-11 rounded-xl px-4" size="lg">
                <a
                  href={actions.deepLink}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Открыть Telegram
                  <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
                </a>
              </Button>
            )}
            <ActionButton
              label="Проверить связь"
              onClick={() => {
                actions.confirm(state.linkRef);
              }}
              pending={actions.pending}
              variant={actions.deepLink === null ? "default" : "outline"}
            />
          </>
        ),
        content: {
          description:
            "Откройте бота, отправьте команду /start и вернитесь сюда. Затем проверьте связь — повторная загрузка страницы не создаст новую попытку.",
          title: "Ожидаем подтверждения",
          tone: "pending",
        },
      };
    case "linked":
      return {
        actions: null,
        content: {
          description:
            "Связь подтверждена. Она сохраняется при окончании Membership и не является разрешением на доступ.",
          title: "Telegram связан",
          tone: "active",
        },
      };
    case "conflict":
      return {
        actions:
          state.supportUrl === undefined ? null : (
            <SupportLink url={state.supportUrl} />
          ),
        content: {
          description:
            "Эта Telegram identity уже связана с другим Account. Автоматический перенос отключён; обратитесь к владельцу сообщества.",
          title: "Обнаружен конфликт",
          tone: "warning",
        },
      };
    case "retryable":
      return {
        actions: (
          <ActionButton
            label="Начать заново"
            onClick={actions.begin}
            pending={actions.pending}
          />
        ),
        content: {
          description:
            state.reason === "expired"
              ? "Срок предыдущей попытки истёк. Можно безопасно начать новую привязку."
              : "Ответ предыдущей попытки уже использован. Можно безопасно начать новую привязку.",
          title:
            state.reason === "expired"
              ? "Срок попытки истёк"
              : "Попытка уже использована",
          tone: "warning",
        },
      };
    case "unavailable":
      return {
        actions: (
          <UnavailableLinkAction
            confirm={actions.confirm}
            pending={actions.pending}
            refresh={actions.refresh}
            retry={state.retry}
          />
        ),
        content: {
          description:
            "Сервис связи не ответил. Account и существующая связь не изменились; повторите безопасный шаг.",
          title: "Telegram временно недоступен",
          tone: "warning",
        },
      };
    case "recovery-required":
      return {
        actions:
          state.recovery.url === undefined ? null : (
            <SupportLink url={state.recovery.url} />
          ),
        content: {
          description:
            "Автоматическое продолжение остановлено, чтобы не перенести identity молча. Обратитесь к владельцу сообщества.",
          title: "Нужна ручная проверка",
          tone: "warning",
        },
      };
  }
}

function membershipView(
  state: AccountTelegramMembership["membership"],
  actions: { readonly pending: boolean; readonly refresh: () => void },
): { readonly actions: ReactNode; readonly content: StateContent } {
  switch (state.kind) {
    case "active":
      return {
        actions: (
          <Button asChild className="h-11 rounded-xl px-4" size="lg">
            <Link href="/library">Открыть Базу знаний</Link>
          </Button>
        ),
        content: {
          description:
            "Текущий Membership подтверждён. Каждый закрытый материал всё равно проверяет доступ заново при открытии.",
          title: "Доступ активен",
          tone: "active",
        },
      };
    case "inactive":
      return {
        actions: (
          <Button
            asChild
            className="h-11 rounded-xl px-4"
            size="lg"
            variant="outline"
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
        content: {
          description:
            "Действующий Membership сейчас не подтверждён. Бесплатные материалы и ваш Account остаются доступны.",
          title: "Доступ не активен",
          tone: "pending",
        },
      };
    case "stale":
      return {
        actions: (
          <ActionButton
            label="Обновить состояние"
            onClick={actions.refresh}
            pending={actions.pending}
            variant="outline"
          />
        ),
        content: {
          description:
            "Последнее подтверждение устарело, поэтому закрытые материалы временно недоступны. Platform ожидает новое состояние.",
          title: "Нужно обновление Membership",
          tone: "warning",
        },
      };
    case "unavailable":
      return {
        actions: (
          <ActionButton
            label="Обновить состояние"
            onClick={actions.refresh}
            pending={actions.pending}
            variant="outline"
          />
        ),
        content: {
          description:
            "Platform не может подтвердить текущий Membership и безопасно не открывает закрытые материалы.",
          title: "Состояние Membership недоступно",
          tone: "warning",
        },
      };
  }
}

interface StateContent {
  readonly description: string;
  readonly title: string;
  readonly tone: "active" | "pending" | "warning";
}
