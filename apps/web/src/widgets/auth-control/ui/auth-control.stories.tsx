import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { HeaderAuthControl } from "./auth-control.client";

const meta = {
  args: { state: "guest" },
  component: HeaderAuthControl,
  decorators: [
    (Story) => (
      <div
        data-public-shell
        className="min-h-64 bg-background p-6 text-foreground"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <Story />
      </div>
    ),
  ],
  parameters: {
    docs: {
      description: {
        component:
          "Один identity control в шапке для всех размеров. Фикстура задаёт только состояние; production использует существующий app adapter и POST-формы входа/выхода.",
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
export const MobileGuest: Story = {
  globals: { viewport: { isRotated: false, value: "mobile320" } },
};
