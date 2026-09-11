import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { GuideShowcasePrototype } from "@/workshop/guide-showcase.prototype";

const meta = {
  component: GuideShowcasePrototype,
  // A full-page prototype has nothing to show in a Docs block: the block caps its
  // height and clips the page instead of scrolling it. Review it as a story.
  tags: ["!autodocs"],
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "Throwaway prototype of the Guide showcase: the page a visitor meets before the programme. It answers what the Guide is, who it is for, what is inside and what stays outside, and its one action opens the programme. No price, no checkout and no production data path — those remain owner decisions.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Pages/Guide showcase/Prototype",
} satisfies Meta<typeof GuideShowcasePrototype>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Mobile · Витрина",
};

export const Desktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Desktop · Витрина",
};

export const OpensProgramme: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Переход к программе",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 2, name: "Кому это нужно" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Открыть программу" }));
    await expect(
      canvas.getByRole("heading", { level: 1, name: /^Программа · / }),
    ).toBeVisible();
    await expect(canvas.getAllByText("Открыт").length).toBeGreaterThan(0);
    await userEvent.click(canvas.getByRole("button", { name: "Назад к описанию" }));
    await expect(canvas.getByRole("button", { name: "Открыть программу" })).toBeVisible();
  },
};

export const Owned: Story = {
  args: { owned: true },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Уже куплено · сразу программа",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { level: 1, name: /^Программа · / })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Открыть программу" })).not.toBeInTheDocument();
  },
};

export const EnlargedText: Story = {
  globals: { viewport: { isRotated: false, value: "mobile320" } },
  name: "320 px · текст 200%",
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const fontSize = root.style.fontSize;
    try {
      root.style.fontSize = "200%";
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
      await expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    } finally {
      root.style.fontSize = fontSize;
    }
  },
};
