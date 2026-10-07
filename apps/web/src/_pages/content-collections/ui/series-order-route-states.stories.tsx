import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import { SeriesOrderRouteState } from "@/features/series-order";
import {
  MaterialAuthoringSignInActions,
  MaterialAuthoringUnauthorizedState,
} from "@/widgets/material-authoring/route-states";
import {
  authoringPageEnvironment,
  routeContent,
} from "@/storybook/story-environment";

const seriesId = "95000000-0000-4000-8000-000000000010";
const editorPath = `/authoring/products/${seriesId}`;
const environment = authoringPageEnvironment(editorPath);

/** Состояния маршрута редактора продукта, которые страница показывает вместо редактора. */
const meta = {
  ...environment,
  args: { state: { kind: "not_found" } },
  component: SeriesOrderRouteState,
  title: "Pages/Authoring/Состояния редактора продукта",
} satisfies Meta<typeof SeriesOrderRouteState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Продукта с таким адресом нет в списке. */
export const NotFound: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Продукт не найден",
      }),
    ).toBeVisible();
  },
};

/** Список продуктов не прочитан: повтор открывает тот же адрес. */
export const LoadError: Story = {
  args: {
    retryHref: editorPath,
    state: { kind: "error", reference: "backend-unavailable" },
  },
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByText(
        "Код обращения: backend-unavailable",
      ),
    ).toBeVisible();
  },
};

/** Сессия не подтверждена: экран входа возвращает в редактор этого продукта. */
export const SignedOut: Story = {
  render: () => (
    <MaterialAuthoringUnauthorizedState
      action={<MaterialAuthoringSignInActions returnHref={editorPath} />}
      context="editor"
    />
  ),
  play: async ({ canvasElement }) => {
    await expect(
      routeContent(canvasElement).getByRole("heading", {
        name: "Нет доступа к редактору",
      }),
    ).toBeVisible();
  },
};
