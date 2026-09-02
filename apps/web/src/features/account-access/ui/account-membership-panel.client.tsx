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
  type TelegramLinkContent,
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
        <TelegramState state={presentation.link} {...flow} />
        <MembershipState
          pending={flow.pending}
          refresh={flow.refresh}
          state={presentation.membership}
        />
      </div>

      <MutationNotice result={flow.mutationResult} />
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

function MutationNotice({ result }: {
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
  flow: TelegramActionFlow,
): { readonly actions: ReactNode; readonly content: TelegramLinkContent } {
  const presentation = telegramLinkPresentation(state);
  return {
    actions: telegramAction(presentation.action, flow),
    content: presentation.account,
  };
}

type TelegramActionFlow = Pick<
  TelegramLinkFlow,
  "begin" | "confirm" | "deepLink" | "pending" | "refresh"
>;

function telegramAction(action: TelegramLinkAction, flow: TelegramActionFlow) {
  switch (action.kind) {
    case "begin":
      return (
        <ActionButton
          label={action.context === "initial" ? "Связать Telegram" : "Начать заново"}
          onClick={flow.begin}
          pending={flow.pending}
        />
      );
    case "confirm":
      return (
        <>
          {action.context === "linking" && flow.deepLink !== null ? (
            <Button asChild className="h-11 rounded-xl px-4" size="lg">
              <a href={flow.deepLink} rel="noopener noreferrer" target="_blank">
                Открыть Telegram
                <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
              </a>
            </Button>
          ) : null}
          <ActionButton
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
    case "none":
      return null;
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
