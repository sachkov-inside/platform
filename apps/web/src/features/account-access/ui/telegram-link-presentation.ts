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
            "Свяжите Account с Telegram, чтобы Platform могла получить ваш Membership state. Сама связь не открывает материалы.",
          title: "Telegram не связан",
          tone: "pending",
        },
        action: { context: "initial", kind: "begin" },
        onboarding: {
          description:
            "Свяжите аккаунт с ботом Inside. Это займёт меньше минуты.",
          title: "Подключите Telegram",
          tone: "pending",
        },
      };
    case "linking":
      return {
        account: {
          description:
            "Откройте бота, отправьте команду /start и вернитесь сюда. Затем проверьте связь — повторная загрузка страницы не создаст новую попытку.",
          title: "Ожидаем подтверждения",
          tone: "pending",
        },
        action: {
          context: "linking",
          kind: "confirm",
          linkRef: state.linkRef,
        },
        onboarding: {
          description: "Откройте бота, нажмите Start и вернитесь сюда.",
          title: "Завершите подключение",
          tone: "pending",
        },
      };
    case "linked":
      return {
        account: {
          description:
            "Связь подтверждена. Она сохраняется при окончании Membership и не является разрешением на доступ.",
          title: "Telegram связан",
          tone: "active",
        },
        action: { kind: "complete" },
        onboarding: {
          description: "Готово — аккаунт связан с Telegram.",
          title: "Telegram подключён",
          tone: "active",
        },
      };
    case "conflict":
      return {
        account: {
          description:
            "Эта Telegram identity уже связана с другим Account. Автоматический перенос отключён; обратитесь к владельцу сообщества.",
          title: "Обнаружен конфликт",
          tone: "warning",
        },
        action:
          state.supportUrl === undefined
            ? { kind: "none" }
            : { kind: "support", url: state.supportUrl },
        onboarding: {
          description:
            "Этот Telegram уже связан с другим аккаунтом. Напишите владельцу сообщества.",
          title: "Не получилось подключить",
          tone: "warning",
        },
      };
    case "retryable":
      return {
        account: {
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
        action: { context: "retry", kind: "begin" },
        onboarding: {
          description:
            "Предыдущая попытка закончилась. Можно безопасно начать заново.",
          title: "Подключите Telegram заново",
          tone: "warning",
        },
      };
    case "unavailable":
      return {
        account: {
          description:
            "Сервис связи не ответил. Account и существующая связь не изменились; повторите безопасный шаг.",
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
          description: "Не удалось проверить связь. Попробуйте ещё раз.",
          title: "Telegram временно недоступен",
          tone: "warning",
        },
      };
    case "recovery-required":
      return {
        account: {
          description:
            "Автоматическое продолжение остановлено, чтобы не перенести identity молча. Обратитесь к владельцу сообщества.",
          title: "Нужна ручная проверка",
          tone: "warning",
        },
        action:
          state.recovery.url === undefined
            ? { kind: "none" }
            : { kind: "support", url: state.recovery.url },
        onboarding: {
          description:
            "Автоматически продолжить не получилось. Напишите владельцу сообщества.",
          title: "Нужна помощь с подключением",
          tone: "warning",
        },
      };
  }
}
