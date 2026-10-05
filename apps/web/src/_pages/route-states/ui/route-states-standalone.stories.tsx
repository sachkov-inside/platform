import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { StandalonePageError } from "./route-states";

/** Сбой раскладки раздела или корня: оболочки уже нет, как в `app/error.tsx` и `global-error.tsx`. */
const meta = {
  component: StandalonePageError,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  title: "Pages/Route states/Without shell",
  args: { onRetry: fn() },
} satisfies Meta<typeof StandalonePageError>;

export default meta;
type Story = StoryObj<typeof meta>;

const desktop = {
  viewport: { isRotated: false, value: "desktop1440" },
} as const;
const mobile = { viewport: { isRotated: false, value: "mobile390" } } as const;

export const LayoutErrorDesktop: Story = {
  globals: desktop,
  name: "Layout error · desktop",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Страница сейчас недоступна",
      }),
    ).toBeVisible();
  },
};

export const LayoutErrorMobile: Story = {
  globals: mobile,
  name: "Layout error · mobile",
  play: async ({ args, canvasElement }) => {
    const page = within(canvasElement);
    page.getByRole("button", { name: "Повторить" }).click();
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};
