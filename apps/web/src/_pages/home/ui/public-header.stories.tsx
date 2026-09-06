import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import type { HomeView } from "../model/home-view";
import { HomePage } from "./home-page";
import { illustratedHome } from "./illustrated-home.fixture";
import { HeaderAuthControl } from "@/widgets/auth-control";
import {
  ApplicationShell,
  type ApplicationNavigationItem,
} from "@/widgets/application-shell";

const navigationItems = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
] satisfies readonly ApplicationNavigationItem[];

const home: HomeView = {
  ...illustratedHome,
  videos: illustratedHome.videos.map((item) => ({ ...item, cover: null })),
  guides: illustratedHome.guides
    .slice(0, 3)
    .map((item) => ({ ...item, cover: null })),
  topics: illustratedHome.topics
    .slice(0, 1)
    .map((item) => ({ ...item, cover: null })),
  playlists: illustratedHome.playlists.map((item) => ({
    ...item,
    cover: null,
    previewItems: item.previewItems.map((material) => ({
      ...material,
      cover: null,
    })),
  })),
};

const meta = {
  args: {
    currentPath: "/",
    navigationItems,
    mobileNavigationItems: [...navigationItems, { href: "/account", icon: "profile", label: "Профиль" }],
    children: null,
    accountSlot: <HeaderAuthControl state="guest" />,
  },
  component: ApplicationShell,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Рабочая верхняя шапка Platform с выбранным словесным логотипом C — Sachkov Inside. На desktop — разделы, поиск, вход и меню аккаунта. На mobile — прежняя нижняя навигация без верхней шапки. Используется тот же компонент, что в публичных маршрутах; содержимое главной — демонстрационные данные.",
      },
    },
  },
  render: ({ children, ...args }) => {
    void children;
    return (
      <div
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <ApplicationShell {...args}>
          <HomePage result={{ kind: "ready", value: home }} />
        </ApplicationShell>
      </div>
    );
  },
  title: "Patterns/Mobile-first Platform/Navigation",
} satisfies Meta<typeof ApplicationShell>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopHeader: Story = {
  name: "Desktop · Sachkov Inside",
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const header = canvas.getByRole("banner");
    await expect(
      within(header).getByRole("link", { name: "Sachkov Inside" }),
    ).toBeVisible();
    await expect(
      within(header).getByRole("button", { name: "Войти" }),
    ).toBeVisible();
    await expect(
      canvas.queryByRole("complementary", { name: "Боковая панель" }),
    ).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("navigation", { name: "Разделы главной" }),
    ).not.toBeInTheDocument();
    const main = canvas.getByRole("main");
    const headerTop = header.getBoundingClientRect().top;
    main.scrollTop = 500;
    await expect(header.getBoundingClientRect().top).toBe(headerTop);
    await expect(main.scrollTop).toBeGreaterThan(0);
    main.scrollTop = 0;
  },
};

export const Authenticated: Story = {
  name: "Desktop · аккаунт",
  args: {
    accountSlot: <HeaderAuthControl state="authenticated" />,
    currentPath: "/series/platform-inside",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(
      canvas
        .getByRole("navigation", { name: "Основная" })
        .querySelector('[aria-current="page"]'),
    ).toHaveTextContent("База знаний");
    const trigger = canvas.getByRole("button", { name: "Аккаунт" });
    await userEvent.click(trigger);
    await expect(
      body.getByRole("menuitem", { name: "Профиль" }),
    ).toHaveAttribute("href", "/account");
    await expect(
      body.getByRole("menuitem", { name: "Выйти" }).closest("form"),
    ).toHaveAttribute("method", "post");
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
  },
};

export const MobileBottomNavigation: Story = {
  name: "Mobile 320 · нижняя навигация",
  args: { currentPath: "/materials/example" },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("banner")).not.toBeInTheDocument();
    await expect(
      canvas.queryByRole("button", { name: "Открыть меню" }),
    ).not.toBeInTheDocument();
    const navigation = canvas.getByRole("navigation", {
      name: "Мобильная навигация",
    });
    await expect(within(navigation).getAllByRole("link")).toHaveLength(3);
    await expect(
      within(navigation).getByRole("link", { name: "База знаний" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      within(navigation).getByRole("link", { name: "Профиль" }),
    ).toHaveAttribute("href", "/account");
    await expect(
      within(navigation)
        .getAllByRole("link")
        .every((link) => link.getBoundingClientRect().height >= 44),
    ).toBe(true);
    const document = canvasElement.ownerDocument;
    const scrollRoot = document.scrollingElement;
    if (scrollRoot === null) throw new Error("Document scroll is missing");
    const before = navigation.getBoundingClientRect().top;
    scrollRoot.scrollTop = 600;
    await expect(scrollRoot.scrollTop).toBeGreaterThan(0);
    await expect(navigation.getBoundingClientRect().top).toBe(before);
    scrollRoot.scrollTop = 0;
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
  },
};

export const MobileAccount: Story = {
  name: "Mobile · профиль выбран",
  args: { currentPath: "/account" },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Unavailable: Story = {
  name: "Статус сессии недоступен",
  args: { accountSlot: <HeaderAuthControl state="unavailable" /> },
};
