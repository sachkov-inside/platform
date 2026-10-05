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
