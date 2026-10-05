import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { publicPageEnvironment } from "@/storybook/story-environment";

import { PublicNavigationPending } from "./public-navigation-pending";

/**
 * Переход из мобильной навигации: пока App Router получает маршрут, оболочка сразу показывает
 * каркас назначения. Это тот же модуль, что рисует `AppShell`.
 */
const meta = {
  ...publicPageEnvironment("/"),
  component: PublicNavigationPending,
  tags: ["autodocs"],
  title: "Pages/Navigation pending",
  args: { href: "/" },
} satisfies Meta<typeof PublicNavigationPending>;
export default meta;
type Story = StoryObj<typeof meta>;

const desktop = { viewport: { isRotated: false, value: "desktop1440" } };
const mobile = { viewport: { isRotated: false, value: "mobile390" } };

/**
 * Скелет главной ещё не знает закрепа и места под продукт не держит: лента открывает каркас
 * вплотную к его верху.
 */
async function homeSkeletonReservesNoProduct({
  canvasElement,
}: {
  readonly canvasElement: HTMLElement;
}) {
  const frame = canvasElement.querySelector(".home-page");
  if (frame === null) throw new Error("Каркас главной не отрисован");
  const materials = within(canvasElement).getByRole("region", {
    name: "Материалы",
  });
  await expect(materials).toHaveAttribute("aria-busy", "true");
  await expect(materials.parentElement).toBe(frame);
  await expect(frame.querySelector(":scope > :not(h1, .home-feed)")).toBeNull();
  await expect(
    materials.getBoundingClientRect().top - frame.getBoundingClientRect().top,
  ).toBe(Number.parseFloat(getComputedStyle(materials).marginTop));
}

export const Home: Story = {
  globals: desktop,
  play: homeSkeletonReservesNoProduct,
};
export const HomeMobile: Story = {
  globals: mobile,
  play: homeSkeletonReservesNoProduct,
};
export const AccountMobile: Story = {
  args: { href: "/account" },
  globals: mobile,
};
