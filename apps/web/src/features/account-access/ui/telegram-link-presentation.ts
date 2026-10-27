import type { AccountTelegramMembership } from "../model/account-telegram-membership";

export interface TelegramLinkContent {
  readonly description: string;
  readonly title: string;
  readonly tone: "active" | "pending" | "warning";
}

export type TelegramLinkAction =
  | Readonly<{ kind: "begin"; context: "initial" | "retry" }>
  | Readonly<{
      kind: "confirm";
      context: "linking" | "retry";
      linkRef: string;
    }>
  | Readonly<{ kind: "refresh" }>
  | Readonly<{ kind: "support"; url: string }>
  | Readonly<{ kind: "complete" }>
  | Readonly<{ kind: "none" }>;

export function telegramLinkPresentation(
  state: AccountTelegramMembership["link"],
): {
  readonly account: TelegramLinkContent;
  readonly action: TelegramLinkAction;
  readonly onboarding: TelegramLinkContent;
} {
  switch (state.kind) {
    case "unlinked":
      return {
        account: {
          description:
            "Подключите Telegram через бота. Это займёт меньше минуты.",
          title: "Telegram не подключён",
          tone: "pending",
        },
        action: { context: "initial", kind: "begin" },
        onboarding: {
          description:
            "Бот сообщает о новых материалах и помогает вступить в сообщество, если оно входит в ваш доступ. Подключение займёт меньше минуты.",
          title: "Подключите Telegram",
          tone: "pending",
        },
      };
    case "linking":
      return {
        account: {
          description:
            "Нажмите Start в боте и вернитесь сюда. Подключение проверим автоматически.",
          title: "Подключаем Telegram",
          tone: "pending",
        },
        action: {
          context: "linking",
          kind: "confirm",
          linkRef: state.linkRef,
        },
        onboarding: {
          description:
            "Нажмите Start в боте и вернитесь сюда. Подключение проверим автоматически.",
          title: "Подключаем Telegram",
          tone: "pending",
        },
      };
    case "linked":
      return {
        account: {
          description: "Аккаунт подключён к Telegram.",
          title: "Telegram подключён",
          tone: "active",
        },
        action: { kind: "complete" },
        onboarding: {
          description: "Аккаунт подключён к Telegram.",
          title: "Telegram подключён",
          tone: "active",
        },
      };
    case "conflict":
      return {
        account: {
          description:
            "Этот Telegram уже подключён к другому аккаунту. Для переноса обратитесь к владельцу сообщества.",
          title: "Telegram занят другим аккаунтом",
          tone: "warning",
        },
        action:
          state.supportUrl === undefined
            ? { kind: "none" }
            : { kind: "support", url: state.supportUrl },
        onboarding: {
          description:
            "Этот Telegram уже связан с другим аккаунтом. Напишите владельцу сообщества.",
          title: "Не удалось подключить Telegram",
          tone: "warning",
        },
      };
    case "retryable":
      return {
        account: {
          description:
            state.reason === "expired"
              ? "Время подключения истекло. Подключите Telegram заново."
              : "Эта ссылка уже использована. Подключите Telegram заново.",
          title:
            state.reason === "expired"
              ? "Время подключения истекло"
              : "Ссылка уже использована",
          tone: "warning",
        },
        action: { context: "retry", kind: "begin" },
        onboarding: {
          description: "Подключение не завершено. Попробуйте ещё раз.",
          title: "Подключите Telegram заново",
          tone: "warning",
        },
      };
    case "unavailable":
      return {
        account: {
          description: "Не удалось проверить подключение. Попробуйте ещё раз.",
          title: "Telegram временно недоступен",
          tone: "warning",
        },
        action:
          state.retry.kind === "confirm"
            ? {
                context: "retry",
                kind: "confirm",
                linkRef: state.retry.linkRef,
              }
            : { kind: "refresh" },
        onboarding: {
          description: "Не удалось проверить подключение. Попробуйте ещё раз.",
          title: "Telegram временно недоступен",
          tone: "warning",
        },
      };
    case "recovery-required":
      return {
        account: {
          description:
            "Не удалось продолжить подключение. Для проверки аккаунта обратитесь к владельцу сообщества.",
          title: "Нужна ручная проверка",
          tone: "warning",
        },
        action:
          state.recovery.url === undefined
            ? { kind: "none" }
            : { kind: "support", url: state.recovery.url },
        onboarding: {
          description:
            "Не удалось продолжить подключение. Напишите владельцу сообщества.",
          title: "Нужна помощь с подключением",
          tone: "warning",
        },
      };
  }
}
