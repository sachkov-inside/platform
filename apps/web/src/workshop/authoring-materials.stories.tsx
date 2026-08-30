import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";

import type {
  AuthoringMaterialsQuery,
  AuthoringMaterialsState,
} from "@/_pages/authoring-materials/model/authoring-materials-presentation";
import {
  AuthoringMaterialsLoading,
  AuthoringMaterialsView,
} from "@/_pages/authoring-materials/ui/authoring-materials-view";

const query = { page: 1 } satisfies AuthoringMaterialsQuery;
const readyState = {
  kind: "ready",
  items: [
    {
      format: "Guide",
      materialId: "96000000-0000-4000-8000-000000000001",
      publicationState: "published",
      title: "Как устроен Inside",
      topic: "Platform",
      updatedAt: "2026-08-30T13:40:00.000Z",
    },
    {
      format: "Guide",
      materialId: "96000000-0000-4000-8000-000000000002",
      publicationState: "draft",
      title: "Работа с материалами",
      topic: "Platform",
      updatedAt: "2026-08-30T12:15:00.000Z",
    },
    {
      format: null,
      materialId: "96000000-0000-4000-8000-000000000003",
      publicationState: "unpublished",
      title: null,
      topic: null,
      updatedAt: "2026-08-29T17:10:00.000Z",
    },
  ],
  page: 1,
  pageSize: 20,
  totalItems: 35,
  totalPages: 2,
} satisfies Extract<AuthoringMaterialsState, { readonly kind: "ready" }>;

const meta = {
  args: { query, state: readyState },
  component: AuthoringMaterialsView,
  parameters: {
    docs: {
      description: {
        component:
          "Production-представление списка материалов. Серверный маршрут и Storybook передают только сериализуемое состояние; авторизация и transport остаются вне UI.",
      },
    },
    nextjs: { appDirectory: true },
  },
  title: "Страницы/Редактор/Материалы",
} satisfies Meta<typeof AuthoringMaterialsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  name: "Список · широкий экран",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Материалы", level: 1 })).toBeVisible();
    await expect(canvas.getByText("35 материалов")).toBeVisible();
    await expect(canvas.getAllByText("Платформа").length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("Руководство").length).toBeGreaterThan(0);
    await expect(canvas.queryByText(/^v\d+$/u)).not.toBeInTheDocument();
    await expect(canvas.queryByText("Topic", { exact: true })).not.toBeInTheDocument();
    await expect(canvas.queryByText("Format", { exact: true })).not.toBeInTheDocument();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Список · мобильный",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Материалы", level: 1 })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Новый материал" })).toBeVisible();
    await expectNoHorizontalOverflow(canvasElement);
  },
};

export const Keyboard: Story = {
  name: "Список · клавиатура",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "Перейти к содержанию" })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: /Редактор Inside/u })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole("link", { name: "Материалы" })).toHaveFocus();
  },
};

export const TextZoom: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
  name: "Список · 200% текста",
  play: async ({ canvasElement }) => {
    const root = canvasElement.ownerDocument.documentElement;
    const previousFontSize = root.style.fontSize;
    root.style.fontSize = "200%";
    try {
      await expectNoHorizontalOverflow(canvasElement);
      await expect(within(canvasElement).getByRole("link", { name: "Новый материал" })).toBeVisible();
    } finally {
      root.style.fontSize = previousFontSize;
    }
  },
};

export const Empty: Story = {
  args: {
    state: { ...readyState, items: [], totalItems: 0, totalPages: 0 },
  },
  name: "Пустой список",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Первый материал ещё не создан" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Создать материал" })).toBeVisible();
  },
};

export const NoResults: Story = {
  args: {
    query: { page: 1, search: "не найдено" },
    state: { ...readyState, items: [], totalItems: 0, totalPages: 0 },
  },
  name: "Ничего не найдено",
};

export const Paginated: Story = {
  args: {
    query: { page: 2 },
    state: { ...readyState, page: 2, totalItems: 57, totalPages: 3 },
  },
  name: "Пагинация",
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Страница 2 из 3")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Назад" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Далее" })).toBeVisible();
  },
};

export const Loading: Story = {
  render: () => <AuthoringMaterialsLoading />,
  name: "Загрузка",
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText("Загрузка списка материалов")).toHaveAttribute("aria-busy", "true");
  },
};

export const SignedOut: Story = {
  args: { state: { kind: "signed_out" } },
  name: "Нужен вход",
};

export const Forbidden: Story = {
  args: { state: { kind: "forbidden" } },
  name: "Нет доступа",
};

export const Unavailable: Story = {
  args: { state: { kind: "unavailable", reference: "dependency-unavailable" } },
  name: "Сервис недоступен",
};

export const MalformedResponse: Story = {
  args: { state: { kind: "malformed_response" } },
  name: "Неполный ответ",
};

export const UnexpectedError: Story = {
  args: { state: { kind: "unexpected_error", reference: "request-failed" } },
  name: "Непредвиденная ошибка",
};

async function expectNoHorizontalOverflow(canvasElement: HTMLElement) {
  const storyWindow = canvasElement.ownerDocument.defaultView;
  if (storyWindow === null) throw new Error("Story window is unavailable");
  await expect(canvasElement.ownerDocument.documentElement.scrollWidth).toBeLessThanOrEqual(
    storyWindow.innerWidth + 1,
  );
}
