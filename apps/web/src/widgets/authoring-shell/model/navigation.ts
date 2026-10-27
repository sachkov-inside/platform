import type { Route } from "next";

import { authoringOverviewHref } from "@/shared/routing/authoring";

/**
 * Разделы админки по решению 2 спецификации #1717. Один источник для боковой панели, нижней
 * панели телефона, листа «Ещё», вкладок подразделов и Storybook.
 *
 * «Обзор» (#1719) живёт на самом `/authoring`, «Люди» ведут в список людей #1721, продажи (#1718)
 * живут под `/authoring/sales/*`; прежние `/authoring/access`, `/authoring/billing` и
 * `/authoring/sales-funnel` перенаправляет `next.config.ts`. «Сообщений» нет, пока в силе решение
 * #396.
 */
export type AuthoringNavigationItemId =
  | "overview"
  | "products"
  | "materials"
  | "topics"
  | "people"
  | "submissions"
  | "payments"
  | "payment-links"
  | "discounts"
  | "sales-funnel";

export type AuthoringNavigationIcon =
  | "overview"
  | "products"
  | "materials"
  | "topics"
  | "people"
  | "submissions"
  | "payments"
  | "payment-links"
  | "discounts"
  | "sales-funnel";

export interface AuthoringNavigationItem {
  readonly id: AuthoringNavigationItemId;
  readonly label: string;
  readonly href: Route;
  readonly icon: AuthoringNavigationIcon;
  /** Адреса, на которых пункт текущий: сам адрес раздела и всё, что под ним. */
  readonly paths: readonly string[];
  /**
   * Пункт текущий только на самих `paths`, а не под ними: под `/authoring` лежат все разделы,
   * поэтому «Обзор» текущий только на стартовой странице.
   */
  readonly exact?: true;
  /** Счётчик у пункта; по решению 2 он есть только у «Сдач». */
  readonly counter?: "submissions-awaiting-feedback";
}

export interface AuthoringNavigationGroup {
  readonly id: "overview" | "content" | "learners" | "sales";
  /** Подпись группы; у «Обзора» её нет. */
  readonly label: string | null;
  readonly items: readonly [
    AuthoringNavigationItem,
    ...AuthoringNavigationItem[],
  ];
}

export { authoringOverviewHref };

const overview = {
  id: "overview",
  label: "Обзор",
  href: authoringOverviewHref,
  icon: "overview",
  paths: [authoringOverviewHref],
  exact: true,
} as const satisfies AuthoringNavigationItem;

const people = {
  id: "people",
  label: "Люди",
  href: "/authoring/people",
  icon: "people",
  paths: ["/authoring/people"],
} as const satisfies AuthoringNavigationItem;

const submissions = {
  id: "submissions",
  label: "Сдачи",
  href: "/authoring/submissions",
  icon: "submissions",
  paths: ["/authoring/submissions"],
  counter: "submissions-awaiting-feedback",
} as const satisfies AuthoringNavigationItem;

const payments = {
  id: "payments",
  label: "Платежи",
  href: "/authoring/sales/payments",
  icon: "payments",
  paths: ["/authoring/sales/payments"],
} as const satisfies AuthoringNavigationItem;

export const authoringNavigation: readonly AuthoringNavigationGroup[] = [
  { id: "overview", label: null, items: [overview] },
  {
    id: "content",
    label: "Контент",
    items: [
      {
        id: "products",
        label: "Продукты",
        href: "/authoring/products",
        icon: "products",
        // `/authoring/playlists` остаётся прежним совместимым адресом продуктов.
        paths: ["/authoring/products", "/authoring/playlists"],
      },
      {
        id: "materials",
        label: "Материалы",
        href: "/authoring/materials",
        icon: "materials",
        paths: ["/authoring/materials"],
      },
      {
        id: "topics",
        label: "Темы",
        href: "/authoring/topics",
        icon: "topics",
        paths: ["/authoring/topics"],
      },
    ],
  },
  { id: "learners", label: "Ученики", items: [people, submissions] },
  {
    id: "sales",
    label: "Продажи",
    items: [
      payments,
      {
        id: "payment-links",
        label: "Ссылки на оплату",
        href: "/authoring/sales/links",
        icon: "payment-links",
        paths: ["/authoring/sales/links"],
      },
      {
        id: "discounts",
        label: "Скидки",
        href: "/authoring/sales/discounts",
        icon: "discounts",
        paths: ["/authoring/sales/discounts"],
      },
      {
        id: "sales-funnel",
        label: "Воронка продаж",
        href: "/authoring/sales/funnel",
        icon: "sales-funnel",
        paths: ["/authoring/sales/funnel"],
      },
    ],
  },
];

/** Пункт нижней панели телефона: раздел или группа, которую он открывает. */
export interface AuthoringMobileTab {
  readonly item: AuthoringNavigationItem;
  /** Группа, любой текущий пункт которой делает вкладку текущей. */
  readonly group?: AuthoringNavigationGroup["id"];
}

/**
 * Нижняя панель решения 13: Обзор, Люди, Продажи, Сдачи и «Ещё» (его рисует сама оболочка).
 * «Продажи» открывают первый подраздел продаж и остаются текущими во всей группе.
 */
export const authoringMobileTabs: readonly AuthoringMobileTab[] = [
  { item: overview },
  { item: people },
  { item: { ...payments, label: "Продажи" }, group: "sales" },
  { item: submissions },
];

/** Пункты, которых нет в нижней панели: их показывает лист «Ещё». */
export const authoringMoreGroups: readonly {
  readonly id: AuthoringNavigationGroup["id"];
  readonly label: string;
  readonly items: readonly AuthoringNavigationItem[];
}[] = authoringNavigation.flatMap((group) => {
  const items = group.items.filter(
    (item) => !authoringMobileTabs.some((tab) => tab.item.id === item.id),
  );
  return group.label === null || items.length === 0
    ? []
    : [{ id: group.id, label: group.label, items }];
});

function matches(item: AuthoringNavigationItem, pathname: string): boolean {
  return item.paths.some(
    (path) =>
      pathname === path ||
      (item.exact !== true && pathname.startsWith(`${path}/`)),
  );
}

/** Где находится автор: текущий пункт и его группа. Предпросмотр черновика вне разделов. */
export function authoringLocation(pathname: string): {
  readonly item: AuthoringNavigationItem | undefined;
  readonly group: AuthoringNavigationGroup | undefined;
  /** Автор на корне раздела, а не на объекте внутри него: тогда показываются вкладки подразделов. */
  readonly atSectionRoot: boolean;
  readonly preview: boolean;
} {
  const preview = pathname.endsWith("/preview");
  if (preview)
    return {
      item: undefined,
      group: undefined,
      atSectionRoot: false,
      preview,
    };
  for (const group of authoringNavigation) {
    const item = group.items.find((candidate) => matches(candidate, pathname));
    if (item !== undefined)
      return {
        item,
        group,
        atSectionRoot: item.paths.includes(pathname),
        preview,
      };
  }
  return { item: undefined, group: undefined, atSectionRoot: false, preview };
}
