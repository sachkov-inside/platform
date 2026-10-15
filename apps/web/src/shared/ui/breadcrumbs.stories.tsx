import { productPath } from "@/shared/routing/public-page-path";
import {
  productProgrammeHref,
  productTaskHref,
} from "@/shared/routing/subscription-route";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { publicPageEnvironment } from "@/storybook/story-environment";
import { Breadcrumbs } from "./breadcrumbs";

const meta = {
  ...publicPageEnvironment("/materials/brief"),
  title: "Shared/Breadcrumbs",
  component: Breadcrumbs,
  args: {
    items: [
      { label: "Inside AI Engineering", href: productPath("ai-engineering") },
      {
        label: "Глава 1",
        fullLabel: "Подготовь проект к разработке",
        href: productProgrammeHref("ai-engineering"),
      },
      {
        label: "Задание",
        fullLabel: "Подготовь проект к работе с агентом",
        href: productTaskHref("ai-engineering", "aie-ch1-harness"),
        restoreOrigin: true,
      },
      { label: "Бриф заказчика" },
    ],
  },
} satisfies Meta<typeof Breadcrumbs>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CourseLocation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole("navigation", { name: "Хлебные крошки" });
    await expect(within(nav).getAllByRole("link")).toHaveLength(3);
    await expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent(
      "Бриф заказчика",
    );
    await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBe(
      canvasElement.ownerDocument.documentElement.clientWidth,
    );
  },
};
export const Mobile: Story = {
  ...CourseLocation,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
