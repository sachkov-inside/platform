import type { Route } from "next";

export type AccountSectionId =
  | "profile"
  | "access"
  | "purchases"
  | "subscription"
  | "notifications";

export interface AccountSection {
  readonly id: AccountSectionId;
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
    summary: "Аватар, имя и о себе — видите только вы",
  },
  {
    id: "access",
    href: "/account/access",
    label: "Аккаунт",
    summary: "Связь с Telegram, принятые документы и выход",
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

/** Название и задача раздела живут в одном месте: их берут и навигация, и заголовок раздела. */
export const accountSectionById: Readonly<
  Record<AccountSectionId, AccountSection>
> = Object.fromEntries(
  sections.map((section) => [section.id, section]),
) as Readonly<Record<AccountSectionId, AccountSection>>;

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
    (section) =>
      section.id !== "subscription" || subscriptionOwned,
  );
}
