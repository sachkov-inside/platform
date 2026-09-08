import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { MaterialReadingContext, type MaterialPreview } from "@/entities/material";
import type { PublishedSeriesResult } from "@/features/library-discovery";
import { ApplicationShell, type ApplicationNavigationItem } from "@/widgets/application-shell";
import { LibraryDiscoveryView } from "./library-discovery-view";

const navigation = [{ href: "/", icon: "home", label: "Главная" }, { href: "/library", icon: "library", label: "База знаний" }] satisfies readonly ApplicationNavigationItem[];
const titles = ["От идеи к первой версии", "Границы продукта", "Сценарии пользователя", "Модель предметной области", "Выбор технической основы", "Первый вертикальный срез", "Хранение данных", "Миграции без потери данных", "Вход и сессии", "Права доступа", "Контракты API", "Проверки приложения", "Настройка CI", "Сборка образа", "Секреты и конфигурация", "Подготовка сервера", "Первый деплой", "Обновление приложения", "Логи и диагностика", "Метрики и оповещения", "Резервное копирование", "Восстановление после сбоя", "Проверка под нагрузкой", "Что улучшать дальше"];
const materials = titles.map((title, index): MaterialPreview => ({
  materialId: `series-material-${String(index + 1)}`, slug: `series-material-${String(index + 1)}`, title,
  access: index < 3 ? "free" : "membership", availability: "available", format: index % 3 === 0 ? "Видео" : "Гайд", formatSlug: index % 3 === 0 ? "video" : "guide",
  ...(index % 3 === 0 ? { primaryVideoDurationSeconds: 1260 + index * 10 } : {}),
  summary: "", topic: "Platform", topicSlug: "platform", tags: [],
  seriesMemberships: [{ name: "Создание Platform Inside", slug: "platform-inside", ordinal: index + 1 }],
}));
const result = { discoveryKind: "series", kind: "ready", hasNext: false, reference: { name: "Создание Platform Inside", slug: "platform-inside", summary: "От продуктовой идеи до работающего приложения." }, items: materials, relatedSeries: [], topics: [] } satisfies PublishedSeriesResult;
const resume = { materialSlug: "series-material-13", label: "Продолжить с 12:40" };
const register = () => () => undefined;
const refresh = () => Promise.resolve();
const meta = {
  component: LibraryDiscoveryView,
  title: "Pages/Mobile-first Platform/Series journey",
  parameters: { layout: "fullscreen", docs: { description: { component: "Production-owned Series page. Illustrative 24-material composition exercises progress, pagination, continuation and per-material access without editorial or provider claims." } } },
  args: { result, learning: { kind: "ready", read: 8, total: 24, continuation: resume }, onRetry: fn() },
  decorators: [(Story, context) => {
    const view = context.args.learning;
    const read = view?.kind === "ready" ? view.read : 0;
    const states = new Map(materials.slice(0, read).map((item) => [item.materialId ?? "", { isRead: true, version: 1 }]));
    return <MaterialReadingContext value={{ accountId: view?.kind === "guest" ? null : "story-account", resolved: true, states, register, refresh, failed: false }}><ApplicationShell currentPath="/series/platform-inside" navigationItems={navigation} mobileNavigationItems={[...navigation, { href: "/account", icon: "profile", label: "Профиль" }]}><Story /></ApplicationShell></MaterialReadingContext>;
  }],
} satisfies Meta<typeof LibraryDiscoveryView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("progressbar", { name: "Прогресс серии" })).toHaveAttribute("value", "8");
    await expect(canvasElement.querySelectorAll("[data-series-ordinal]")).toHaveLength(12);
    await expect(canvas.queryByRole("button", { name: "Показать в маршруте" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Страница 2, продолжение" })).toHaveAttribute("aria-current", "page");
    await expect(canvas.getByText("Материалы 13–24 из 24")).toBeVisible();
    await expect(canvasElement.querySelector('[data-series-ordinal="13"]')).toHaveAttribute("aria-current", "step");
    await expect(canvas.getByRole("progressbar")).toHaveAttribute("value", "8");
    await expect(canvas.getAllByRole("link", { name: "Настройка CI" })[0]).toHaveAttribute("href", expect.stringContaining("page%3D2%26at%3Dseries-material-13"));
    await userEvent.click(canvas.getByRole("button", { name: "Страница 1" }));
    await expect(canvas.getByText("Материалы 1–12 из 24")).toBeVisible();
    await expect(canvas.getByRole("img", { name: "Материал 1, изучен" })).toBeVisible();
    await expect(canvasElement.querySelector('[data-series-marker-read="true"] svg')).toBeInTheDocument();
  },
};
export const Mobile: Story = { globals: { viewport: { value: "mobile390", isRotated: false } } };
const lockedResult = { ...result, items: materials.map((material, index) => ({ ...material, availability: index < 3 ? "available" as const : "locked" as const })) };
export const Guest: Story = {
  args: { result: lockedResult, learning: { kind: "guest" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("progressbar")).not.toBeInTheDocument();
    await expect(canvas.getByRole("link", { name: "Начать серию" })).toBeVisible();
    await expect(canvas.getAllByText("Бесплатно")).toHaveLength(3);
    await expect(canvas.getAllByText("По подписке")).toHaveLength(9);
    await expect(canvas.getByRole("link", { name: "Модель предметной области" })).toBeVisible();
  },
};
export const FreeAccount: Story = { args: { result: lockedResult, learning: { kind: "ready", read: 2, total: 24, continuation: { materialSlug: "series-material-3", label: "Продолжить здесь" } } } };
export const ExpiredMembership: Story = { args: { result: lockedResult, learning: { kind: "ready", read: 8, total: 24, continuation: null } } };
export const Completed: Story = { args: { learning: { kind: "ready", read: 24, total: 24, continuation: null } } };
export const ProgressUnavailable: Story = { args: { learning: { kind: "unavailable" } }, play: async ({ canvasElement, args }) => { await userEvent.click(within(canvasElement).getByRole("button", { name: "Повторить загрузку прогресса" })); await expect(args.onRetry).toHaveBeenCalled(); } };
export const Loading: Story = { args: { learning: { kind: "loading" } } };
export const AccessUnavailable: Story = { args: { result: { ...result, items: materials.map((material) => ({ ...material, availability: "unavailable" })) }, learning: { kind: "ready", read: 8, total: 24, continuation: null } } };
export const ShortSeries: Story = { args: { result: { ...result, items: materials.slice(0, 2) }, learning: { kind: "ready", read: 0, total: 2, continuation: null } }, play: async ({ canvasElement }) => { await expect(within(canvasElement).queryByRole("navigation", { name: "Страницы маршрута" })).not.toBeInTheDocument(); } };

function ProgressResolution({ longTitle = false }: { longTitle?: boolean }) {
  const [ready, setReady] = useState(false);
  return <>
    <button onClick={() => { setReady(true); }} type="button">Получить прогресс (проверка)</button>
    <LibraryDiscoveryView result={longTitle ? { ...result, items: materials.map((item) => item.slug === resume.materialSlug ? { ...item, title: "Настройка непрерывной интеграции приложения" } : item) } : result} learning={ready ? { kind: "ready", read: 8, total: 24, continuation: resume } : { kind: "loading" }} />
  </>;
}
export const LoadingPreservesRoutePosition: Story = {
  render: () => <ProgressResolution />,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const top = canvas.getByRole("heading", { name: "Маршрут" }).getBoundingClientRect().top;
    await userEvent.click(canvas.getByRole("button", { name: "Получить прогресс (проверка)" }));
    await expect(canvas.getByRole("progressbar")).toHaveAttribute("value", "8");
    await expect(Math.abs(canvas.getByRole("heading", { name: "Маршрут" }).getBoundingClientRect().top - top)).toBeLessThan(1);
  },
};
export const DesktopLoadingPreservesRoutePosition: Story = { ...LoadingPreservesRoutePosition, globals: { viewport: { value: "desktop1440", isRotated: false } } };
export const TabletLoadingPreservesRoutePosition: Story = {
  ...LoadingPreservesRoutePosition,
  render: () => <ProgressResolution longTitle />,
  parameters: { viewport: { options: { tablet768: { name: "Tablet 768", styles: { width: "768px", height: "1024px" }, type: "tablet" } } } },
  globals: { viewport: { value: "tablet768", isRotated: false } },
};
export const EnlargedText: Story = {
  args: { learning: { kind: "unavailable" } },
  globals: { viewport: { value: "mobile320", isRotated: false } },
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const fontSize = root.style.fontSize;
    try {
      root.style.fontSize = "200%";
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
      await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    } finally { root.style.fontSize = fontSize; }
  },
};

export const EnlargedTextInProgress: Story = { ...EnlargedText, args: {} };
export const EnlargedTextGuest: Story = { ...EnlargedText, args: Guest.args ?? {} };

const videoSummary = "Разбираем путь от коммита до работающего сервиса: сборку, публикацию и откат.";
const compactRouteResult = {
  ...result,
  items: materials.slice(0, 3).map((material, index) => ({
    ...material,
    title: index === 0 ? "Как устроен релиз моего проекта" : material.title,
    summary: videoSummary,
  })),
};
const compactRouteArgs = {
  result: compactRouteResult,
  learning: { kind: "ready", read: 1, total: 3, continuation: { materialSlug: "series-material-2", label: "Продолжить здесь" } },
} satisfies Story["args"];

export const CompactMobileRoute: Story = {
  args: compactRouteArgs,
  globals: { viewport: { value: "mobile390", isRotated: false } },
  play: async ({ canvasElement }) => {
    const route = within(canvasElement).getByRole("list", { name: "Материалы серии" });
    const rows = within(route);
    await expect(rows.getByText(videoSummary)).not.toBeVisible();
    await expect(rows.getByText("Продолжить здесь")).not.toBeVisible();
    for (const topic of rows.getAllByText("Platform")) await expect(topic).not.toBeVisible();
    await expect(rows.getByRole("link", { name: "Как устроен релиз моего проекта" })).toHaveAttribute("href", expect.stringContaining("series-material-1"));
    await expect(rows.getByText("Просмотрено")).toBeVisible();
    await expect(rows.getAllByText("Бесплатно")).toHaveLength(3);
    await expect(route.querySelector('[data-series-ordinal="2"]')).toHaveAttribute("aria-current", "step");
    for (const card of route.querySelectorAll("article")) await expect(card.getBoundingClientRect().height).toBeLessThan(160);
  },
};

export const DesktopRouteDetails: Story = {
  args: compactRouteArgs,
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const route = within(within(canvasElement).getByRole("list", { name: "Материалы серии" }));
    await expect(route.getByText(videoSummary)).toBeVisible();
    await expect(route.getByText("Продолжить здесь")).toBeVisible();
    for (const topic of route.getAllByRole("link", { name: "Platform" })) await expect(topic).toBeVisible();
  },
};
