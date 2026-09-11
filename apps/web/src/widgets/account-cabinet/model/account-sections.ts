import type { Route } from "next";

export interface AccountSection {
  readonly id:
    | "profile"
    | "access"
    | "purchases"
    | "subscription"
    | "notifications";
  readonly href: Route;
  readonly label: string;
  /** Одна задача раздела, названная словами владельца аккаунта. */
  readonly summary: string;
}

const sections = [
  {
    id: "profile",
    href: "/account",
    label: "Профиль",
    summary: "Аватар, имя, о себе и ссылка для участников",
  },
  {
    id: "access",
    href: "/account/access",
    label: "Аккаунт",
    summary: "Связь с Telegram и выход",
  },
  {
    id: "purchases",
    href: "/account/purchases",
    label: "Покупки",
    summary: "Что доступно, списания, чеки и способ оплаты",
  },
  {
    id: "subscription",
    href: "/account/subscription",
    label: "Подписка",
    summary: "Тариф, срок, следующее списание и управление",
  },
  {
    id: "notifications",
    href: "/account/notifications",
    label: "Уведомления",
    summary: "Каналы, по которым приходят сообщения",
  },
] as const satisfies readonly AccountSection[];

export const accountSections: readonly AccountSection[] = sections;

/**
 * «Подписка» появляется, когда её продают или когда она уже есть. Пока её не продают и у
 * человека её нет, раздел не занимает место: кабинет остаётся полезным без подписки.
 */
export function visibleAccountSections({
  subscriptionOffered,
  subscriptionOwned,
}: {
  readonly subscriptionOffered: boolean;
  readonly subscriptionOwned: boolean;
}): readonly AccountSection[] {
  return accountSections.filter(
    (section) =>
      section.id !== "subscription" || subscriptionOffered || subscriptionOwned,
  );
}
