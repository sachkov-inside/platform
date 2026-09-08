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
    await expect(canvasElement.querySelector('[data-series-marker-read="true"]')).toHaveTextContent("1");
    await userEvent.click(canvas.getByRole("button", { name: "Показать в маршруте" }));
    await expect(canvas.getByText("Материалы 13–24 из 24")).toBeVisible();
    await expect(canvasElement.querySelector('[data-series-ordinal="13"]')).toHaveAttribute("aria-current", "step");
    await expect(canvas.getByRole("progressbar")).toHaveAttribute("value", "8");
    await expect(canvas.getAllByRole("link", { name: "Настройка CI" })[0]).toHaveAttribute("href", expect.stringContaining("page%3D2%26at%3Dseries-material-13"));
    await userEvent.click(canvas.getByRole("button", { name: "Страница 1" }));
    await expect(canvas.getByText("Материалы 1–12 из 24")).toBeVisible();
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
