import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import {
  publicPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

import { MapPage } from "./map-page";

const meta = {
  ...publicPageEnvironment("/map"),
  component: MapPage,
  title: "Pages/Map",
  tags: ["autodocs"],
} satisfies Meta<typeof MapPage>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Раздел пока без редакционных связей: страница честно говорит, что они появятся позже. */
export const Desktop: Story = {
  globals: { viewport: { value: "desktop1440", isRotated: false } },
  play: async ({ canvasElement }) => {
    const page = routeContent(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Карта Inside" }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Связи появятся постепенно" }),
    ).toBeVisible();
  },
};

export const Mobile: Story = {
  ...Desktop,
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
