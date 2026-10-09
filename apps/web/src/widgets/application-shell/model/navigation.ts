import { authoringMaterialsRootHref } from "@/shared/routing/authoring";

import type { ApplicationNavigationItem } from "../ui/application-shell.client";

/** Разделы публичной шапки. Один источник для приложения и для Storybook. */
export const publicNavigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/bookmarks", icon: "bookmark", label: "Закладки" },
] as const satisfies readonly ApplicationNavigationItem[];

/** Мобильная навигация добавляет профиль: на телефоне кабинет открывают отсюда. */
export const publicMobileNavigationItems = [
  ...publicNavigationItems,
  { href: "/account", icon: "profile", label: "Профиль" },
] as const satisfies readonly ApplicationNavigationItem[];

/**
 * Курс виден тому, кому открыт продукт: из витрины в прохождение одно нажатие. Адрес сам решает,
 * в какую программу вести (решение владельца 09.10.2026).
 */
export const courseNavigationItem = {
  href: "/learning",
  icon: "course",
  label: "Курс",
} as const satisfies ApplicationNavigationItem;

/** Мобильная навигация для текущего доступа: «Курс» стоит сразу после Главной. */
export function mobileNavigationItemsFor({
  hasCourse,
}: {
  readonly hasCourse: boolean;
}): readonly ApplicationNavigationItem[] {
  if (!hasCourse) return publicMobileNavigationItems;
  const [home, ...rest] = publicMobileNavigationItems;
  return [home, courseNavigationItem, ...rest];
}

/** Редактор виден только тому, кто ведёт материалы. */
export const authoringNavigationItem = {
  href: authoringMaterialsRootHref,
  icon: "pen",
  label: "Редактор",
} as const satisfies ApplicationNavigationItem;

/** Разделы шапки для текущих прав: редактор добавляется последним. */
export function navigationItemsFor({
  canManageMaterials,
  hasCourse = false,
}: {
  readonly canManageMaterials: boolean;
  /** Открыт ли человеку продукт: тогда в шапке есть «Курс». */
  readonly hasCourse?: boolean;
}): readonly ApplicationNavigationItem[] {
  const [home, ...rest] = publicNavigationItems;
  const items: readonly ApplicationNavigationItem[] = hasCourse
    ? [home, courseNavigationItem, ...rest]
    : publicNavigationItems;
  return canManageMaterials ? [...items, authoringNavigationItem] : items;
}
