import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { publicHeaderEnvironment } from "@/workshop/story-environment";

import { HeaderAuthControl } from "./auth-control.client";

const environment = publicHeaderEnvironment();

const meta = {
  args: { state: "guest" },
  component: HeaderAuthControl,
  ...environment,
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Управление аккаунтом в desktop-шапке. На mobile используется страница Профиля. Фикстура задаёт только состояние; production использует существующий app adapter и POST-формы входа/выхода.",
      },
    },
  },
  title: "Patterns/Identity/Auth control",
} satisfies Meta<typeof HeaderAuthControl>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Guest: Story = {};
export const Authenticated: Story = { args: { state: "authenticated" } };
export const Unavailable: Story = {
  args: { state: "unavailable" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Сессия" }));
    await expect(
      body.getByRole("menuitem", { name: "Завершить сессию" }).closest("form"),
    ).toHaveAttribute("action", "/auth/sign-out");
    await userEvent.keyboard("{Escape}");
  },
};
