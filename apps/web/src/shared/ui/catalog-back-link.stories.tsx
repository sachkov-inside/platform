import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { productProgrammeHref } from "@/shared/routing/subscription-route";
import { CatalogBackLink } from "./catalog-back-link";

const meta = {
  title: "Components/Catalog back link",
  component: CatalogBackLink,
  args: { href: "/", label: "Главная" },
  tags: ["autodocs"],
} satisfies Meta<typeof CatalogBackLink>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("link", { name: "Главная" })).toHaveAttribute(
      "href",
      "/",
    );
  },
};
export const Programme: Story = {
  args: {
    href: productProgrammeHref("ai-engineering"),
    label: "Назад к программе",
  },
};
