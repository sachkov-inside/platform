import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlertCircle } from "lucide-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { Button } from "./button";
import { StatusPanel } from "./status-panel";

const retry = fn();
const meta = {
  ...publicPageEnvironment("/materials/agent-setup"),
  title: "Components/Feedback/Status panel",
  component: StatusPanel,
  args: {
    title: "Материал недоступен",
    message: "Не удалось загрузить материал. Попробуйте ещё раз.",
    icon: <AlertCircle aria-hidden="true" />,
    state: { "data-material-state": "unavailable" },
    action: <Button onClick={retry}>Повторить</Button>,
  },
  parameters: {
    docs: {
      description: {
        component:
          "Общая панель состояния страницы: заголовок, объяснение и действие восстановления. Полные состояния маршрутов находятся в Pages / Route states.",
      },
    },
  },
} satisfies Meta<typeof StatusPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Unavailable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("heading", { name: "Материал недоступен", level: 1 }),
    ).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Повторить" }));
    await expect(retry).toHaveBeenCalledOnce();
  },
};
export const Mobile: Story = {
  ...Unavailable,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
