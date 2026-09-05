import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { MobileFirstPlatformPrototype } from "@/workshop/mobile-first-platform.prototype";

const meta = {
  component: MobileFirstPlatformPrototype,
  parameters: {
    docs: {
      description: {
        component:
          "Throwaway mobile-first prototype of the selected Home, Library, Topic, Playlist and Material flow.",
      },
    },
  },
  title: "Pages/Mobile-first Platform/Prototype",
} satisfies Meta<typeof MobileFirstPlatformPrototype>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  args: {},
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Mobile · interactive",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Профиль" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Открыть профиль" })).not.toBeInTheDocument();
    await expect(getComputedStyle(document.documentElement).scrollbarWidth).toBe("none");
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
    await expect(canvasElement.querySelectorAll("[data-playlist-card]")).toHaveLength(2);

    const videoGrid = canvasElement.querySelector<HTMLElement>("[data-video-grid]");
    await expect(videoGrid).not.toBeNull();

    const covers = videoGrid?.querySelectorAll<HTMLElement>("[data-video-cover]") ?? [];
    await expect(covers).toHaveLength(4);
    const [firstCover, secondCover] = covers;
    if (!firstCover || !secondCover) {
      throw new Error("В первом ряду сетки видео не хватает превью");
    }
    await expect(
      Math.abs(firstCover.getBoundingClientRect().top - secondCover.getBoundingClientRect().top),
    ).toBeLessThanOrEqual(1);
  },
};

export const MobileCompact: Story = {
  args: {},
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  name: "Mobile · compact 320",
};

export const BackNavigationFlow: Story = {
  args: {},
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Navigation · real back path",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("button", { name: "AI-first" }));
    await expect(canvas.getByRole("button", { name: "Назад: На главную" })).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Открыть плейлист AI-first работа" }));
    await expect(canvas.getByRole("button", { name: "Назад: К теме" })).toBeVisible();

    const materialTitle = canvas.getByText("Мой AI-first контур");
    const materialButton = materialTitle.closest("button");
    if (!materialButton) throw new Error("Материал в маршруте не является кнопкой");
    await userEvent.click(materialButton);
    await expect(canvas.getByRole("button", { name: "Назад: К плейлисту" })).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Назад: К плейлисту" }));
    await userEvent.click(canvas.getByRole("button", { name: "Назад: К теме" }));
    await userEvent.click(canvas.getByRole("button", { name: "Назад: На главную" }));
    await expect(canvas.getByRole("heading", { name: "Новые видео" })).toBeVisible();
  },
};

export const LibraryMobile: Story = {
  args: { initialScreen: "library" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Library · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("tablist")).not.toBeInTheDocument();
    await expect(canvas.getByRole("heading", { name: "Темы" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Плейлисты" })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Материалы" })).toBeVisible();
    await expect(canvasElement.querySelectorAll("[data-playlist-card]")).toHaveLength(3);

    await userEvent.type(canvas.getByRole("searchbox", { name: "Поиск по Базе знаний" }), "production");
    await expect(canvas.getByRole("button", { name: "Открыть тему Инфраструктура" })).toBeVisible();
    await expect(canvas.getByText("Контур поставки")).toBeVisible();
    await expect(canvas.getByText("Разбираем production-инцидент")).toBeVisible();

    await userEvent.click(canvas.getByRole("button", { name: "Очистить поиск" }));
    await expect(canvas.queryByRole("button", { name: "Фильтры" })).not.toBeInTheDocument();
    await userEvent.type(canvas.getByRole("searchbox", { name: "Поиск по Базе знаний" }), "несуществующий запрос");
    await expect(canvas.getByRole("heading", { name: "Ничего не нашли" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Сбросить всё" }));
    await expect(canvas.getByRole("heading", { name: "Темы" })).toBeVisible();
  },
};

export const TopicMobile: Story = {
  args: { initialScreen: "topic", initialTopicLabel: "AI-first" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Topic · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "AI-first" })).toBeVisible();
    const playlistsHeading = canvas.getByRole("heading", { name: "Плейлисты" });
    const materialsHeading = canvas.getByRole("heading", { name: "Материалы" });
    await expect(playlistsHeading.compareDocumentPosition(materialsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

export const PlaylistMobile: Story = {
  args: { initialPlaylistId: "ai-first-work", initialScreen: "playlist" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Playlist · mobile",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: "AI-first работа" })).toBeVisible();
    await expect(canvasElement.querySelectorAll("ol > li")).toHaveLength(7);
  },
};

export const GuideReaderMobile: Story = {
  args: { initialMaterialId: "auth-without-dead-ends", initialScreen: "material" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Reader · guide",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Содержание · 2")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Отметить прочитанным" })).toBeVisible();
    await expect(canvas.queryByRole("heading", { name: "По теме" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Найти похожее" })).not.toBeInTheDocument();
  },
};

export const VideoReaderMobile: Story = {
  args: { initialMaterialId: "delivery-without-rituals", initialScreen: "material" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Reader · video",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Воспроизвести видео «CI/CD без ритуалов»" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Смотреть видео" })).not.toBeInTheDocument();
  },
};

export const LockedReaderMobile: Story = {
  args: { audience: "visitor", initialMaterialId: "deep-modules", initialScreen: "material" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Reader · locked",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Получить доступ" })).toBeVisible();
    await expect(canvas.queryByText("Сначала разделяем понятия")).not.toBeInTheDocument();
  },
};

export const VisitorLibraryMobile: Story = {
  args: { audience: "visitor", initialScreen: "library" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Library · visitor access",
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('[data-access-cover="locked"]')).not.toHaveLength(0);
  },
};

export const Desktop: Story = {
  args: {},
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Desktop · home",
  play: verifyBoundedDesktop,
};

export const LibraryDesktop: Story = {
  args: { initialScreen: "library" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Desktop · library",
  play: async (context) => {
    await verifyBoundedDesktop(context);
    await verifyExpandableDesktopNavigation(context);
  },
};

export const TopicDesktop: Story = {
  args: { initialScreen: "topic", initialTopicLabel: "AI-first" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Desktop · topic",
  play: verifyBoundedDesktop,
};

export const PlaylistDesktop: Story = {
  args: { initialPlaylistId: "ai-first-work", initialScreen: "playlist" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Desktop · playlist",
  play: verifyBoundedDesktop,
};

export const GuideReaderDesktop: Story = {
  args: { initialMaterialId: "auth-without-dead-ends", initialScreen: "material" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Desktop · guide reader",
  play: verifyBoundedDesktop,
};

export const VideoReaderDesktop: Story = {
  args: { initialMaterialId: "delivery-without-rituals", initialScreen: "material" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Desktop · video reader",
  play: verifyBoundedDesktop,
};

export const LockedReaderDesktop: Story = {
  args: { audience: "visitor", initialMaterialId: "deep-modules", initialScreen: "material" },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Desktop · locked reader",
  play: verifyBoundedDesktop,
};

async function verifyBoundedDesktop({ canvasElement }: { readonly canvasElement: HTMLElement }) {
  const frame = canvasElement.querySelector<HTMLElement>("[data-page-frame], [data-reader-frame]");
  const navigation = canvasElement.querySelector<HTMLElement>("aside[aria-label='Боковая панель']");
  const scrollSurface = canvasElement.querySelector<HTMLElement>("[data-desktop-scroll]");
  await expect(frame).not.toBeNull();
  await expect(navigation).not.toBeNull();
  await expect(scrollSurface).not.toBeNull();
  if (!frame) throw new Error("Не найдена ограниченная область desktop-контента");
  if (!navigation) throw new Error("Не найдена desktop-навигация");
  if (!scrollSurface) throw new Error("Не найдена прокручиваемая desktop-область");
  await expect(frame.getBoundingClientRect().width).toBeLessThanOrEqual(1088);
  await expect(navigation.getBoundingClientRect().left).toBeLessThanOrEqual(16);
  await expect(getComputedStyle(scrollSurface).scrollbarWidth).not.toBe("none");

  scrollSurface.scrollTo(0, 120);
  await expect(scrollSurface.scrollTop).toBeGreaterThan(0);
  scrollSurface.scrollTo(0, 0);
}

async function verifyExpandableDesktopNavigation({ canvasElement }: { readonly canvasElement: HTMLElement }) {
  const canvas = within(canvasElement);
  const navigation = canvas.getByRole("complementary", { name: "Боковая панель" });
  const hoverRegion = navigation.parentElement;
  const brand = canvas.getByRole("button", { name: "Sachkov Inside" });
  if (!hoverRegion) throw new Error("Не найдена hover-область desktop-навигации");

  await userEvent.unhover(hoverRegion);
  await expect(brand).toHaveTextContent("S");
  await userEvent.hover(hoverRegion);
  await expect(brand).toHaveTextContent("Sachkov Inside");
  await expect(within(navigation).getByText("Главная")).toBeVisible();
  await expect(within(navigation).getByText("База знаний")).toBeVisible();
}
