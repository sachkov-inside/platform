import { authoringMaterialsRootHref } from "@/shared/routing/authoring";

import type { ApplicationNavigationItem } from "../ui/application-shell.client";

/** Разделы публичной шапки. Один источник для приложения и для Storybook. */
export const publicNavigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
  { href: "/bookmarks", icon: "bookmark", label: "Закладки" },
] as const satisfies readonly ApplicationNavigationItem[];

/** Мобильная навигация добавляет профиль: на телефоне кабинет открывают отсюда. */
export const publicMobileNavigationItems = [
  ...publicNavigationItems,
  { href: "/account", icon: "profile", label: "Профиль" },
] as const satisfies readonly ApplicationNavigationItem[];

/** Редактор виден только тому, кто ведёт материалы. */
export const authoringNavigationItem = {
  href: authoringMaterialsRootHref,
  icon: "pen",
  label: "Редактор",
} as const satisfies ApplicationNavigationItem;

/** Разделы шапки для текущих прав: редактор добавляется последним. */
export function navigationItemsFor({
  canManageMaterials,
}: {
  readonly canManageMaterials: boolean;
}): readonly ApplicationNavigationItem[] {
  return canManageMaterials
    ? [...publicNavigationItems, authoringNavigationItem]
    : publicNavigationItems;
}
