import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";

import { textContrast } from "@/storybook/contrast";
import { publicHeaderEnvironment } from "@/storybook/story-environment";

import { themePreferenceStorageKey } from "../model/theme-preference";
import { ThemeSwitch } from "./theme-switch.client";

const environment = publicHeaderEnvironment();

function resetTheme() {
  localStorage.removeItem(themePreferenceStorageKey);
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
}

async function choose(canvasElement: HTMLElement, label: string) {
  const canvas = within(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(
    canvas.getByRole("button", { name: "Тема оформления" }),
  );
  await userEvent.click(body.getByRole("menuitemradio", { name: label }));
}

const meta = {
  ...environment,
  title: "Patterns/Shell/Theme switch",
  component: ThemeSwitch,
  args: { surface: "public" },
  parameters: {
    ...environment.parameters,
    docs: {
      description: {
        component:
          "Выбор темы оформления в шапке: «Светлая», «Тёмная», «Как в системе». Выбор живёт в этом браузере; без выбора сайт светлый.",
      },
    },
  },
  beforeEach: () => {
    const cleanup = environment.beforeEach();
    resetTheme();
    return () => {
      resetTheme();
      cleanup?.();
    };
  },
} satisfies Meta<typeof ThemeSwitch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChoosesDark: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const root = canvasElement.ownerDocument.documentElement;
    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Тема оформления" }),
    );
    await expect(
      body.getByRole("menuitemradio", { name: "Светлая" }),
    ).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Escape}");

    await choose(canvasElement, "Тёмная");
    await waitFor(() => expect(root).toHaveClass("dark"));
    await expect(localStorage.getItem(themePreferenceStorageKey)).toBe("dark");
    // The header text stays readable on the dark page.
    const brand = within(canvasElement).getAllByText("Главная")[0];
    if (brand === undefined) throw new Error("The header has no «Главная»");
    await expect(textContrast(brand)).toBeGreaterThanOrEqual(4.5);

    await userEvent.click(
      within(canvasElement).getByRole("button", { name: "Тема оформления" }),
    );
    await expect(
      body.getByRole("menuitemradio", { name: "Тёмная" }),
    ).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Escape}");

    await choose(canvasElement, "Светлая");
    await waitFor(() => expect(root).not.toHaveClass("dark"));
    await expect(localStorage.getItem(themePreferenceStorageKey)).toBe("light");
  },
};

export const FollowsSystem: Story = {
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const systemDark = matchMedia("(prefers-color-scheme: dark)").matches;
    await choose(canvasElement, "Как в системе");
    await expect(localStorage.getItem(themePreferenceStorageKey)).toBe(
      "system",
    );
    await waitFor(() =>
      expect(root.classList.contains("dark")).toBe(systemDark),
    );
  },
};
