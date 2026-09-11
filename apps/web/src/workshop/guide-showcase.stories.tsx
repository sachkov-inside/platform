import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import { ApplicationShell, type ApplicationNavigationItem } from "@/widgets/application-shell";
import { GuideShowcasePrototype } from "@/workshop/guide-showcase.prototype";

const navigation = [
  { href: "/", icon: "home", label: "Главная" },
  { href: "/library", icon: "library", label: "База знаний" },
] satisfies readonly ApplicationNavigationItem[];

const meta = {
  component: GuideShowcasePrototype,
  // The real shell owns desktop scrolling: from 48rem the document itself is
  // `overflow: hidden` and `#content` scrolls instead. A page reviewed outside
  // the shell cannot scroll on desktop and does not look like the product.
  decorators: [
    (Story) => (
      <ApplicationShell
        currentPath="/guides/ci-and-reproducible-releases"
        mobileNavigationItems={[...navigation, { href: "/account", icon: "profile", label: "Профиль" }]}
        navigationItems={navigation}
      >
        <Story />
      </ApplicationShell>
    ),
  ],
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
      // Scope the check to the page this prototype owns: the shared shell's own
      // skip link already exceeds 320 px at 200% text, which belongs to the shell.
      const page = canvasElement.querySelector<HTMLElement>("[data-guide-showcase]");
      await expect(page?.scrollWidth ?? 0).toBeLessThanOrEqual(root.clientWidth);
    } finally {
      root.style.fontSize = fontSize;
    }
  },
};
