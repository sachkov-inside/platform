import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, spyOn, userEvent, within } from "storybook/test";
import { getStoryRouter } from "../../../.storybook/mocks/next-navigation";
import { RetryPageButton } from "./retry-page-button.client";

const meta = {
  title: "Components/Actions/Retry page",
  component: RetryPageButton,
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Повтор чтения текущего маршрута через router.refresh(). В Storybook роутер подменён; реального запроса к приложению нет.",
      },
    },
  },
} satisfies Meta<typeof RetryPageButton>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Retry: Story = {
  play: async ({ canvasElement }) => {
    const refresh = spyOn(getStoryRouter(), "refresh");
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Повторить" }),
    );
    await expect(refresh).toHaveBeenCalledOnce();
  },
};
