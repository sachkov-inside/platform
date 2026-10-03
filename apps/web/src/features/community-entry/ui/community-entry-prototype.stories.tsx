/**
 * PROTOTYPE for #824 — throwaway, lives only on branch `prototype/824-community-entry-look`.
 *
 * Question: what should the «Сообщество Inside» block look like after payment and in «Покупки»?
 * Three structurally different variants (A — steps, B — list row, C — invite banner), each shown
 * inside both real host pages and in a gallery of every state, including the future «Открыть
 * группу» state from #823. Variant code here is not production code.
 */
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Route } from "next";
import Link from "next/link";
import {
  Check,
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import { useId } from "react";
import { fn } from "storybook/test";

import { billingActionClass } from "@/entities/subscription";
import { PurchaseReturnView } from "@/features/billing-checkout";
import { PurchasesSectionView } from "@/features/billing-subscription/ui/purchases-view.client";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  accessGrounds,
  activeSubscription,
  billingNotices,
  confirmedPurchase,
  ownPayments,
} from "@/workshop/billing.fixtures";
import {
  accountSectionEnvironment,
  publicPageEnvironment,
} from "@/workshop/story-environment";

const botUrl = "https://t.me/inside_storybook_bot";
const groupUrl = "https://t.me/+inside_storybook_group";
const telegramHref: Route = "/account/access";

type StateKey =
  | "join"
  | "link_telegram"
  | "preparing"
  | "member"
  | "member_group"
  | "restricted"
  | "error";

const stateLabels: Record<StateKey, string> = {
  join: "Вступить",
  link_telegram: "Подключить Telegram",
  preparing: "Вход готовится",
  member: "Уже участник",
  member_group: "Уже участник + «Открыть группу» (#823)",
  restricted: "Ограничено",
  error: "Сбой чтения",
};
const stateKeys = Object.keys(stateLabels) as StateKey[];

interface VariantProps {
  readonly state: StateKey;
}

/* ───────────────────────── Variant A — «Путь по шагам» ───────────────────────── */

const stepIndex: Partial<Record<StateKey, number>> = {
  link_telegram: 0,
  preparing: 1,
  join: 1,
  member: 3,
  member_group: 3,
};

function StepsVariant({ state }: VariantProps) {
  const titleId = useId();
  const current = stepIndex[state];
  const header = (
    <div className="flex items-start gap-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent/12 text-action [&_svg]:size-5">
        <UsersRound aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold" id={titleId}>
          Сообщество Inside
        </h2>
        <p className="mt-0.5 text-sm leading-6 text-muted-foreground">
          Общий чат участников в Telegram — открыт вместе с покупкой.
        </p>
      </div>
    </div>
  );
  if (current === undefined) {
    return (
      <section
        aria-labelledby={titleId}
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        {header}
        <Notice state={state} />
      </section>
    );
  }
  const steps = [
    {
      title: "Telegram подключён",
      hint: "Бот узнаёт вас по аккаунту Inside.",
    },
    {
      title: "Ссылка от бота",
      hint:
        state === "preparing"
          ? "Готовим вход — обычно меньше минуты."
          : "Бот выдаёт личную ссылку по /community.",
    },
    { title: "Вы в группе", hint: "Группа появится в вашем Telegram." },
  ];
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-2xl border border-border bg-card p-6 shadow-card"
    >
      {header}
      <ol className="mt-6 grid gap-4 sm:grid-cols-3 sm:gap-3">
        {steps.map((step, index) => {
          const status =
            index < current ? "done" : index === current ? "current" : "next";
          return (
            <li
              aria-current={status === "current" ? "step" : undefined}
              className={cn(
                "flex gap-3 sm:flex-col sm:gap-2 sm:border-t-2 sm:pt-3",
                status === "done" && "sm:border-foreground",
                status === "current" && "sm:border-action",
                status === "next" && "sm:border-border",
              )}
              key={step.title}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full font-mono text-xs font-semibold [&_svg]:size-4",
                  status === "done" && "bg-foreground text-background",
                  status === "current" &&
                    "bg-action text-accent-foreground ring-4 ring-accent/15",
                  status === "next" &&
                    "border border-border text-muted-foreground",
                )}
              >
                {status === "done" ? (
                  <Check aria-hidden="true" />
                ) : status === "current" && state === "preparing" ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  index + 1
                )}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    status === "next" && "text-muted-foreground",
                  )}
                >
                  {step.title}
                </p>
                <p
                  className="mt-0.5 text-sm leading-5 text-muted-foreground"
                  role={
                    status === "current" && state === "preparing"
                      ? "status"
                      : undefined
                  }
                >
                  {step.hint}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <StepsAction state={state} />
    </section>
  );
}

function StepsAction({ state }: VariantProps) {
  switch (state) {
    case "join":
      return (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            asChild
            className={cn(billingActionClass, "h-11 px-4 text-sm")}
          >
            <a href={botUrl} rel="noopener noreferrer" target="_blank">
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
          <Button
            asChild
            className={cn(billingActionClass, "h-11 px-4 text-sm")}
          >
            <Link href={telegramHref}>Подключить Telegram</Link>
          </Button>
        </div>
      );
    case "member_group":
      return (
        <div className="mt-6">
          <Button
            asChild
            className={cn(billingActionClass, "h-11 px-4 text-sm")}
            variant="outline"
          >
            <a href={groupUrl} rel="noopener noreferrer" target="_blank">
              Открыть группу
            </a>
          </Button>
        </div>
      );
    default:
      return null;
  }
}

/** Ограничение и сбой не продвигают путь: шаги заменяет одна спокойная строка. */
function Notice({ state }: VariantProps) {
  const restricted = state === "restricted";
  return (
    <p
      className="mt-5 flex gap-3 rounded-xl bg-muted p-4 text-sm leading-6"
      role={restricted ? undefined : "status"}
    >
      {restricted ? (
        <ShieldAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-(--callout-warning)"
        />
      ) : (
        <RefreshCw
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
        />
      )}
      <span>
        {restricted
          ? "Вступление в сообщество сейчас ограничено. Доступ к материалам сохраняется; если это ошибка, напишите в поддержку."
          : "Не получилось проверить вход в сообщество — повторим автоматически. Доступ к материалам от этого не зависит."}
      </span>
    </p>
  );
}

/* ───────────────────────── Variant B — «Строка в списке» ───────────────────────── */

const rowCopy: Record<
  StateKey,
  { chip: string; tone: "action" | "muted" | "good" | "warning"; line: string }
> = {
  join: {
    chip: "Ждёт вступления",
    tone: "action",
    line: "Бот Inside выдаст личную ссылку в группу по /community.",
  },
  link_telegram: {
    chip: "Нужен Telegram",
    tone: "action",
    line: "Подключите Telegram к аккаунту — бот сразу пришлёт ссылку.",
  },
  preparing: {
    chip: "Готовим вход",
    tone: "muted",
    line: "Обычно меньше минуты — строка обновится сама.",
  },
  member: {
    chip: "Вы участник",
    tone: "good",
    line: "Группа есть в вашем Telegram.",
  },
  member_group: {
    chip: "Вы участник",
    tone: "good",
    line: "Группа есть в вашем Telegram.",
  },
  restricted: {
    chip: "Ограничено",
    tone: "warning",
    line: "Доступ к материалам сохраняется. Если это ошибка, напишите в поддержку.",
  },
  error: {
    chip: "Не проверено",
    tone: "muted",
    line: "Повторим проверку автоматически. Материалы доступны.",
  },
};

const chipTone = {
  action: "bg-accent/12 text-action",
  muted: "bg-muted text-muted-foreground",
  good: "bg-(--callout-good)/12 text-(--callout-good)",
  warning: "bg-(--callout-warning)/14 text-(--callout-warning)",
} as const;

function RowVariant({ state }: VariantProps) {
  const titleId = useId();
  const copy = rowCopy[state];
  const action =
    state === "join" ? (
      <Button asChild className={billingActionClass}>
        <a href={botUrl} rel="noopener noreferrer" target="_blank">
          Вступить в сообщество
        </a>
      </Button>
    ) : state === "link_telegram" ? (
      <Button asChild className={billingActionClass}>
        <Link href={telegramHref}>Подключить Telegram</Link>
      </Button>
    ) : state === "member_group" ? (
      <Button asChild className={billingActionClass} variant="outline">
        <a href={groupUrl} rel="noopener noreferrer" target="_blank">
          Открыть группу
        </a>
      </Button>
    ) : null;
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card sm:flex-row sm:items-center"
    >
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-foreground [&_svg]:size-5">
        <Send aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h2 className="font-semibold" id={titleId}>
            Сообщество Inside
          </h2>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              chipTone[copy.tone],
            )}
            role={
              state === "preparing" || state === "error" ? "status" : undefined
            }
          >
            {state === "preparing" ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-3 animate-spin motion-reduce:animate-none"
              />
            ) : null}
            {copy.chip}
          </span>
        </div>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {copy.line}
        </p>
      </div>
      {action === null ? null : <div className="sm:shrink-0">{action}</div>}
    </section>
  );
}

/* ───────────────────────── Variant C — «Приглашение» ───────────────────────── */

function BannerVariant({ state }: VariantProps) {
  const titleId = useId();
  if (state === "restricted" || state === "error") {
    // Плохие новости не празднуются: тот же блок становится тихой карточкой.
    return (
      <section
        aria-labelledby={titleId}
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <h2 className="font-semibold" id={titleId}>
          Сообщество Inside
        </h2>
        <Notice state={state} />
      </section>
    );
  }
  const member = state === "member" || state === "member_group";
  return (
    <section
      aria-labelledby={titleId}
      className="relative isolate overflow-clip rounded-3xl border border-white/10 bg-cover-ink p-6 text-white shadow-card sm:p-8"
    >
      <span
        aria-hidden="true"
        className="absolute -right-16 -top-20 -z-10 size-64 rounded-full bg-accent-bright/35 blur-2xl"
      />
      <p className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-white/65">
        {member ? "Вы внутри" : "Входит в покупку"}
      </p>
      <h2
        className="mt-3 max-w-[20ch] text-balance text-2xl font-bold tracking-[-0.03em] sm:text-3xl"
        id={titleId}
      >
        {member ? "Вы уже в сообществе Inside" : "Сообщество Inside ждёт вас"}
      </h2>
      <p className="mt-3 max-w-[52ch] text-pretty text-sm leading-6 text-white/75 sm:text-base sm:leading-7">
        {member
          ? "Группа есть в вашем Telegram — там общий чат участников."
          : state === "link_telegram"
            ? "Общий чат участников в Telegram. В группу приглашает бот Inside: подключите Telegram к аккаунту, и бот сразу пришлёт личную ссылку."
            : "Общий чат участников в Telegram. Личную ссылку в группу выдаёт бот Inside — она действует несколько минут и только для вас."}
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {state === "join" ? (
          <a
            className="billing-invite inline-flex min-h-12 items-center gap-2 rounded-xl bg-accent-bright px-5 text-base font-semibold text-white outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-white/60"
            href={botUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <Send aria-hidden="true" className="size-5" />
            Вступить в сообщество
          </a>
        ) : state === "link_telegram" ? (
          <Link
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-5 text-base font-semibold text-cover-ink outline-none hover:bg-white/90 focus-visible:ring-3 focus-visible:ring-white/60"
            href={telegramHref}
          >
            Подключить Telegram
          </Link>
        ) : state === "preparing" ? (
          <p
            className="inline-flex items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold"
            role="status"
          >
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            Готовим вход — обычно меньше минуты
          </p>
        ) : state === "member_group" ? (
          <a
            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/25 px-5 text-base font-semibold outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white/60"
            href={groupUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            Открыть группу
          </a>
        ) : (
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-white/80">
            <CircleCheck aria-hidden="true" className="size-4" />
            Повторно вступать не нужно
          </p>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────── Stories ───────────────────────── */

const variants = {
  A: { name: "Путь по шагам", Component: StepsVariant },
  B: { name: "Строка в списке", Component: RowVariant },
  C: { name: "Приглашение", Component: BannerVariant },
} as const;
type VariantKey = keyof typeof variants;

interface PrototypeArgs {
  readonly variant: VariantKey;
  readonly state: StateKey;
}

function Block({ variant, state }: PrototypeArgs) {
  const { Component } = variants[variant];
  return <Component state={state} />;
}

const meta = {
  title: "Prototype/Community entry (#824)",
  args: { variant: "A", state: "join" },
  argTypes: {
    variant: {
      control: "inline-radio",
      options: Object.keys(variants),
      labels: Object.fromEntries(
        Object.entries(variants).map(([key, value]) => [
          key,
          `${key} — ${value.name}`,
        ]),
      ),
    },
    state: { control: "select", options: stateKeys, labels: stateLabels },
  },
  parameters: {
    docs: {
      description: {
        component:
          "Прототип #824: три варианта блока «Сообщество Inside». Вариант и состояние переключаются в Controls.",
      },
    },
  },
  tags: ["!autodocs", "!test"],
} satisfies Meta<PrototypeArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

const afterPayment = publicPageEnvironment("/subscription/return");
const purchases = accountSectionEnvironment("/account/purchases");

function AfterPaymentHost(args: PrototypeArgs) {
  return (
    <PurchaseReturnView
      accessSlot={<Block {...args} />}
      accountHref="/account/subscription"
      onRefresh={fn()}
      purchase={confirmedPurchase}
    />
  );
}

function PurchasesHost(args: PrototypeArgs) {
  return (
    <PurchasesSectionView
      communitySlot={<Block {...args} />}
      grounds={accessGrounds}
      notices={billingNotices}
      onChangeMethod={fn()}
      onRevokeMethod={fn()}
      payments={ownPayments}
      subscription={activeSubscription}
    />
  );
}

function Gallery({ variant }: PrototypeArgs) {
  return (
    <div className="min-h-screen bg-background p-4 text-foreground sm:p-10">
      <h1 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Вариант {variant} — {variants[variant].name}
      </h1>
      <div className="mt-6 grid max-w-2xl gap-8">
        {stateKeys.map((state) => (
          <div key={state}>
            <p className="mb-2 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <CircleAlert aria-hidden="true" className="size-3" />
              {stateLabels[state]}
            </p>
            <Block state={state} variant={variant} />
          </div>
        ))}
      </div>
    </div>
  );
}

function afterPaymentStory(variant: VariantKey): Story {
  return {
    ...afterPayment,
    args: { variant },
    render: (args) => <AfterPaymentHost {...(args as PrototypeArgs)} />,
  };
}
function purchasesStory(variant: VariantKey): Story {
  return {
    ...purchases,
    args: { variant },
    render: (args) => <PurchasesHost {...(args as PrototypeArgs)} />,
  };
}
function galleryStory(variant: VariantKey): Story {
  return { args: { variant }, render: (args) => <Gallery {...(args as PrototypeArgs)} /> };
}

export const A_AfterPayment = afterPaymentStory("A");
export const A_Purchases = purchasesStory("A");
export const A_AllStates = galleryStory("A");
export const B_AfterPayment = afterPaymentStory("B");
export const B_Purchases = purchasesStory("B");
export const B_AllStates = galleryStory("B");
export const C_AfterPayment = afterPaymentStory("C");
export const C_Purchases = purchasesStory("C");
export const C_AllStates = galleryStory("C");
