import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { PublicSectionHeading } from "./public-section-heading";

const meta = {
  ...publicPageEnvironment("/"),
  title: "Components/Navigation/Section heading",
  component: PublicSectionHeading,
  args: { id: "materials-heading", title: "Материалы" },
  parameters: {
    docs: {
      description: {
        component:
          "Заголовок раздела публичной страницы с необязательным действием справа.",
      },
    },
  },
} satisfies Meta<typeof PublicSectionHeading>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Heading: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole("heading", {
        name: "Материалы",
        level: 2,
      }),
    ).toHaveAttribute("id", "materials-heading");
  },
};
export const WithAside: Story = { args: { aside: <span>12 материалов</span> } };
export const Mobile: Story = {
  ...WithAside,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
