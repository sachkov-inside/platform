import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { JourneyProgress } from "./journey-progress";
const meta = {
  title: "Components/Navigation/JourneyProgress",
  component: JourneyProgress,
  args: {
    labels: ["Telegram", "Сообщество", "Первый урок"],
    current: 1,
    label: "Шаги онбординга",
  },
  parameters: { layout: "padded" },
} satisfies Meta<typeof JourneyProgress>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CurrentStep: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByRole("list", { name: "Шаги онбординга" }),
    ).toBeVisible();
    await expect(canvas.getByText("Сообщество").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
  },
};
export const Completed: Story = { args: { current: 2, completed: true } };
