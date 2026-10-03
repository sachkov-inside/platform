import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { CommunityEntryView } from "./community-entry-view";
import { accountSectionEnvironment } from "@/workshop/story-environment";

const environment = accountSectionEnvironment("/account/purchases");
const botUrl = "https://t.me/inside_storybook_bot";

const meta = {
  ...environment,
  title: "Features/Community/Entry",
  component: CommunityEntryView,
  args: {
    entry: { kind: "join", botUrl },
    telegramHref: "/account/access",
  },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Переход в сообщество Inside рядом с покупкой. Состояние выбирает сервер; личную ссылку в группу выдаёт бот по /community.",
      },
    },
  },
} satisfies Meta<typeof CommunityEntryView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Join: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole("link", { name: "Вступить в сообщество" });
    // Бот понимает обычный /start: новых параметров ссылка не несёт.
    await expect(link).toHaveAttribute("href", botUrl);
    await expect(link).toHaveAttribute("target", "_blank");
  },
};
export const LinkTelegram: Story = {
  args: { entry: { kind: "link_telegram" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("link", { name: "Подключить Telegram" }),
    ).toHaveAttribute("href", "/account/access");
  },
};
export const Preparing: Story = {
  args: { entry: { kind: "preparing" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent(
      /Готовим вход в сообщество/u,
    );
    await expect(
      within(
        canvas.getByRole("region", { name: "Сообщество Inside" }),
      ).queryByRole("link"),
    ).toBeNull();
  },
};
export const Member: Story = {
  args: { entry: { kind: "member" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Участник не зовётся вступать повторно.
    await expect(
      canvas.getByText(/Вы уже в сообществе Inside/u),
    ).toBeInTheDocument();
    await expect(
      within(
        canvas.getByRole("region", { name: "Сообщество Inside" }),
      ).queryByRole("link"),
    ).toBeNull();
  },
};
export const Restricted: Story = {
  args: { entry: { kind: "restricted" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/сейчас ограничено/u)).toBeInTheDocument();
    await expect(
      within(
        canvas.getByRole("region", { name: "Сообщество Inside" }),
      ).queryByRole("link"),
    ).toBeNull();
  },
};
export const WithoutCommunity: Story = {
  args: { entry: { kind: "none" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Сообщество Inside")).toBeNull();
  },
};
export const ReadFailed: Story = {
  args: { entry: null, error: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Чтение повторяется само: ручной кнопки обновления нет.
    const region = canvas.getByRole("region", { name: "Сообщество Inside" });
    await expect(region).toHaveTextContent(/повторим автоматически/u);
    await expect(within(region).queryByRole("button")).toBeNull();
  },
};
export const JoinMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
