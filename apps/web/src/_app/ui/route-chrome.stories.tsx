import type { Meta, StoryObj } from "@storybook/react-vite";
import { Activity, useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import { HideMobileNavigation } from "@/shared/ui/hide-mobile-navigation.client";
import { HidePublicFooter } from "@/shared/ui/hide-public-footer.client";
import { publicPageEnvironment } from "@/storybook/story-environment";

function RetainedRoutes() {
  const [first, setFirst] = useState<"visible" | "hidden" | "unmounted">(
    "visible",
  );
  const [second, setSecond] = useState(false);
  return (
    <div>
      <h1>Страницы со своей навигацией</h1>
      <button
        type="button"
        onClick={() => {
          setSecond(!second);
        }}
      >
        {second ? "Скрыть вторую страницу" : "Открыть вторую страницу"}
      </button>
      <button
        type="button"
        onClick={() => {
          setFirst(first === "visible" ? "hidden" : "visible");
        }}
      >
        {first === "visible"
          ? "Скрыть первую страницу"
          : "Вернуть первую страницу"}
      </button>
      <button
        type="button"
        onClick={() => {
          setFirst("unmounted");
        }}
      >
        Удалить первую страницу
      </button>
      {first === "unmounted" ? null : (
        <Activity mode={first}>
          <section data-route-chrome-first>
            <HideMobileNavigation />
            <HidePublicFooter />
            <p>Первая страница</p>
          </section>
        </Activity>
      )}
      <Activity mode={second ? "visible" : "hidden"}>
        <section>
          <HideMobileNavigation />
          <HidePublicFooter />
          <p>Вторая страница</p>
        </section>
      </Activity>
    </div>
  );
}

const meta = {
  ...publicPageEnvironment("/products/performance-course"),
  title: "Patterns/Route chrome visibility",
  render: () => <RetainedRoutes />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

function retainedRoutes(mobile: boolean): Story {
  return {
    globals: {
      viewport: {
        isRotated: false,
        value: mobile ? "mobile390" : "desktop1440",
      },
    },
    play: async ({ canvasElement }) => {
      const canvas = within(canvasElement);
      const header = canvasElement.querySelector(
        mobile ? ".mobile-navigation" : ".public-header",
      );
      const footer = canvasElement.querySelector(".public-footer-slot");
      const retained = canvasElement.querySelector("[data-route-chrome-first]");
      if (header === null || footer === null || retained === null)
        throw new Error("Missing route chrome fixture");
      const expectChrome = async (shown: boolean) => {
        await expect(getComputedStyle(header).display === "none").toBe(
          mobile && !shown,
        );
        await expect(getComputedStyle(footer).display === "none").toBe(!shown);
      };
      await expectChrome(false);
      await userEvent.click(
        canvas.getByRole("button", { name: "Открыть вторую страницу" }),
      );
      await expectChrome(false);
      await userEvent.click(
        canvas.getByRole("button", { name: "Скрыть первую страницу" }),
      );
      await expectChrome(false);
      await expect(retained.isConnected).toBe(true);
      await expect(getComputedStyle(retained).display).toBe("none");
      await userEvent.click(
        canvas.getByRole("button", { name: "Скрыть вторую страницу" }),
      );
      await expectChrome(true);
      await userEvent.click(
        canvas.getByRole("button", { name: "Вернуть первую страницу" }),
      );
      await expect(
        canvasElement.querySelector("[data-route-chrome-first]"),
      ).toBe(retained);
      await expectChrome(false);
      await userEvent.click(
        canvas.getByRole("button", { name: "Удалить первую страницу" }),
      );
      await expect(retained.isConnected).toBe(false);
      await expectChrome(true);
    },
  };
}

export const RetainedMobile: Story = retainedRoutes(true);
export const RetainedDesktop: Story = retainedRoutes(false);
