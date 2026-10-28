import type { Route } from "next";
import { fn } from "storybook/test";

import { formatMoscowDateTime } from "@/shared/lib/moscow-format";
import { internalRoute } from "@/shared/routing/internal-route";

import { getStoryRouter } from "../../../../.storybook/mocks/next-navigation";
import { AdminRowMenu } from "./admin-row-menu.client";
import type {
  AdminTableColumn,
  AdminTableMobileItem,
} from "./admin-table.client";
import { StateBadge, type AdminStateKey } from "./state-badge";

/** Строка списка материалов в историях: те же поля, что даст страница «Материалы». */
export interface StoryMaterialRow {
  readonly id: string;
  readonly title: string;
  readonly topic: string;
  readonly format: "Гайд" | "Видео" | "Заметка";
  readonly state: AdminStateKey;
  readonly updatedAt: string;
}

const titles = [
  "Как устроен контекст агента и почему он заканчивается раньше, чем кажется",
  "Ревью кода с агентом",
  "Промпт для разбора требований к задаче",
  "Тестирование через поведение: от сценария к проверке",
  "Субагенты",
  "Высоконагруженныеперераспределённыесистемыбезпробелов",
  "Память проекта: AGENTS.md, CLAUDE.md и правила",
  "Как читать трассировку инструмента",
] as const;
const topics = [
  "AI Engineering",
  "Разработка с агентами",
  "Архитектура",
  "Тестирование",
] as const;
const formats = ["Гайд", "Видео", "Заметка"] as const;
const states = [
  "material.published",
  "material.draft",
  "material.unpublished",
] as const satisfies readonly AdminStateKey[];

/** Детерминированный список материалов: без случайности и текущих часов. */
export function storyMaterials(count: number): readonly StoryMaterialRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `material-${String(index + 1)}`,
    title:
      index < titles.length
        ? (titles[index] ?? "Материал")
        : `${titles[index % titles.length] ?? "Материал"} (часть ${String(Math.floor(index / titles.length) + 1)})`,
    topic: topics[index % topics.length] ?? "AI Engineering",
    format: formats[index % formats.length] ?? "Гайд",
    state: states[index % states.length] ?? "material.draft",
    updatedAt: new Date(
      Date.UTC(2026, 9, 24, 11, 5) - index * 7 * 3_600_000,
    ).toISOString(),
  }));
}

export const materialColumns: readonly AdminTableColumn<StoryMaterialRow>[] = [
  {
    id: "title",
    header: "Название",
    cell: (row) => `${row.topic} · ${row.format}`,
  },
  {
    id: "state",
    header: "Состояние",
    width: "11rem",
    cell: (row) => <StateBadge state={row.state} />,
  },
  {
    id: "updatedAt",
    header: "Изменён",
    width: "11rem",
    cell: (row) => formatMoscowDateTime(row.updatedAt),
  },
];

export const materialHref = (row: StoryMaterialRow): Route =>
  internalRoute(`/authoring/materials/${row.id}`);

export const materialMobileItem = (
  row: StoryMaterialRow,
): AdminTableMobileItem => ({
  title: row.title,
  caption: `${row.topic} · ${row.format}`,
  badge: <StateBadge state={row.state} />,
  metric: formatMoscowDateTime(row.updatedAt),
});

export const materialMenuAction = fn();

export function materialActions(row: StoryMaterialRow) {
  return (
    <AdminRowMenu
      items={[
        {
          id: "preview",
          label: "Предпросмотр",
          href: internalRoute(`/authoring/materials/${row.id}/preview`),
        },
        row.state === "material.published"
          ? {
              id: "unpublish",
              label: "Снять с публикации",
              onSelect: () => {
                materialMenuAction("unpublish", row.id);
              },
            }
          : {
              id: "publish",
              label: "Опубликовать",
              onSelect: () => {
                materialMenuAction("publish", row.id);
              },
            },
        {
          id: "delete",
          label: "Удалить черновик",
          tone: "danger",
          disabled: row.state !== "material.draft",
          onSelect: () => {
            materialMenuAction("delete", row.id);
          },
        },
      ]}
      label={`Действия с «${row.title}»`}
    />
  );
}

/** Переход строки в истории: подменяет `router.push` заглушки на время истории. */
export const storyRouterPush = fn();

export function captureRouterPush() {
  storyRouterPush.mockClear();
  const router = getStoryRouter();
  const original = router.push;
  router.push = storyRouterPush;
  return () => {
    router.push = original;
  };
}

/**
 * Цель нажатия: видимая рамка или невидимое поле `::after`, которым кнопки платформы на телефоне
 * добирают 44px при компактном виде (`button.module.css`).
 */
export function touchTarget(element: Element): {
  readonly width: number;
  readonly height: number;
} {
  const box = element.getBoundingClientRect();
  const after = getComputedStyle(element, "::after");
  const size = (value: string) => {
    const parsed = Number.parseFloat(value);
    return after.content === "none" || Number.isNaN(parsed) ? 0 : parsed;
  };
  return {
    width: Math.max(box.width, size(after.width)),
    height: Math.max(box.height, size(after.height)),
  };
}
