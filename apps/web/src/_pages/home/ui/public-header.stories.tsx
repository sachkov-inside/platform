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
    children: null,
    accountSlot: <HeaderAuthControl state="guest" />,
  },
  component: ApplicationShell,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Рабочая верхняя шапка Platform с выбранным словесным логотипом C — Sachkov Inside. Общая модель разделов, видимый вход, меню аккаунта и мобильное меню. Используется тот же компонент, что в публичных маршрутах; содержимое главной — демонстрационные данные.",
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

export const MobileHeader: Story = {
  name: "Mobile 320 · меню",
  args: { currentPath: "/materials/example" },
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(canvas.getByRole("button", { name: "Войти" })).toBeVisible();
    const trigger = canvas.getByRole("button", { name: "Открыть меню" });
    await userEvent.click(trigger);
    const menu = body.getByRole("dialog", { name: "Разделы" });
    const library = within(menu).getByRole("link", { name: "База знаний" });
    await expect(library).toHaveAttribute("aria-current", "page");
    await expect(
      within(menu)
        .getAllByRole("link")
        .every((link) => link.getBoundingClientRect().height >= 44),
    ).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect(trigger).toHaveFocus();
    await expect(
      canvasElement.ownerDocument.documentElement.scrollWidth,
    ).toBeLessThanOrEqual(320);
  },
};

export const MobileAccount: Story = {
  name: "Mobile · аккаунт",
  args: { accountSlot: <HeaderAuthControl state="authenticated" /> },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
export const Unavailable: Story = {
  name: "Статус сессии недоступен",
  args: { accountSlot: <HeaderAuthControl state="unavailable" /> },
};
