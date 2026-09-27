import type { Route } from "next";

export type AccountSectionId =
  "profile" | "access" | "purchases" | "subscription" | "notifications";

export interface AccountSection {
  readonly id: AccountSectionId;
  readonly href: Route;
  readonly label: string;
  /** Одна задача раздела, названная словами владельца аккаунта. */
  readonly summary: string;
}

/** Название и задача раздела живут в одном месте: их берут и навигация, и заголовок раздела. */
export const accountSectionById: {
  readonly [Id in AccountSectionId]: AccountSection & { readonly id: Id };
} = {
  profile: {
    id: "profile",
    href: "/account",
    label: "Профиль",
    summary: "Аватар, имя и о себе — видите только вы",
  },
  access: {
    id: "access",
    href: "/account/access",
    label: "Аккаунт",
    summary: "Связь с Telegram, принятые документы и выход",
  },
  purchases: {
    id: "purchases",
    href: "/account/purchases",
    label: "Покупки",
    summary: "Что доступно, списания, чеки и способ оплаты",
  },
  subscription: {
    id: "subscription",
    href: "/account/subscription",
    label: "Подписка",
    summary: "Тариф, срок, следующее списание и управление",
  },
  notifications: {
    id: "notifications",
    href: "/account/notifications",
    label: "Уведомления",
    summary: "Каналы, по которым приходят сообщения",
  },
};

/** Порядок разделов в навигации — порядок ключей выше. */
export const accountSections: readonly AccountSection[] =
  Object.values(accountSectionById);

/**
 * Раздел подписки доступен для управления уже купленной подпиской.
 */
export function visibleAccountSections({
  subscriptionOwned,
}: {
  readonly subscriptionOffered: boolean;
  readonly subscriptionOwned: boolean;
}): readonly AccountSection[] {
  return accountSections.filter(
    (section) => section.id !== "subscription" || subscriptionOwned,
  );
}
