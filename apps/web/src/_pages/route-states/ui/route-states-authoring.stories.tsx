import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, within } from "storybook/test";

import { authoringMaterialsRootHref } from "@/shared/routing/authoring";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { MaterialAuthoringRouteError } from "@/widgets/material-authoring/route-states";

/** `app/authoring/error.tsx`: авторская оболочка остаётся, повтор перечитывает раздел с сервера. */
const meta = {
  ...authoringPageEnvironment(authoringMaterialsRootHref),
  component: MaterialAuthoringRouteError,
  title: "Pages/Authoring/Route states",
  args: { digest: "2195732781", onRetry: fn() },
} satisfies Meta<typeof MaterialAuthoringRouteError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ErrorDesktop: Story = {
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  name: "Authoring error · desktop",
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(
      page.getByRole("heading", { level: 1, name: "Редактор остановлен" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Вернуться к материалам" }),
    ).toBeVisible();
  },
};

/** Сбой без кода от Next.js: экран называет код границы. */
export const ErrorMobile: Story = {
  args: { digest: undefined },
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Authoring error · mobile",
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByText("Код обращения: authoring-boundary"),
    ).toBeVisible();
  },
};

/** Длинный код обращения не обрезается авторской оболочкой на широком экране. */
export const LongErrorDesktop: Story = {
  args: {
    digest: Array.from({ length: 200 }, () => "error-reference").join(" "),
  },
  globals: { viewport: { isRotated: false, value: "desktop1440" } },
  play: async ({ canvasElement }) => {
    await document.fonts.ready;
    const main = within(canvasElement).getByRole("main");
    await expect(getComputedStyle(main).overflowY).toBe("auto");
    await expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
    const shell = main.parentElement;
    if (shell === null) throw new Error("Нет авторской оболочки");
    await expect(main.getBoundingClientRect().width).toBe(shell.clientWidth);
    await expect(main.scrollWidth).toBe(main.clientWidth);
    main.scrollTop = main.scrollHeight;
    await expect(main.scrollTop).toBeGreaterThan(0);
    const retry = within(canvasElement).getByRole("button", {
      name: "Повторить",
    });
    await expect(retry.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      main.getBoundingClientRect().bottom,
    );
    main.scrollTop = 0;
    await expect(
      within(canvasElement)
        .getByRole("heading", { name: "Редактор остановлен" })
        .getBoundingClientRect().top,
    ).toBeGreaterThanOrEqual(main.getBoundingClientRect().top);
  },
};
