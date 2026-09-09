import type { Meta, StoryObj } from "@storybook/react-vite";
import { keepPreviousData, queryOptions } from "@tanstack/react-query";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";

import {
  SeriesOrderManager,
  type CreateSeriesOrderMaterialSearchQueryOptions,
  type SeriesOrderMaterialSearchResult,
} from "@/features/series-order";
import { withMutationFetch } from "./mutation-mock";

const loadMaterialsSpy = fn(
  (_input: {
    readonly page: number;
    readonly search: string;
    readonly signal: AbortSignal;
  }): Promise<SeriesOrderMaterialSearchResult> =>
    Promise.resolve({
      items: [
        {
          materialId: "95000000-0000-4000-8000-000000000004",
          publicationState: "draft" as const,
          title: "Материал вне руководства",
        },
      ],
      kind: "ready" as const,
      page: 1,
      totalItems: 1,
      totalPages: 1,
    }),
);
const createMaterialSearchQueryOptions: CreateSeriesOrderMaterialSearchQueryOptions =
  ({ page, search }) =>
    queryOptions({
      placeholderData: keepPreviousData,
      queryFn: ({ signal }) => loadMaterialsSpy({ page, search, signal }),
      queryKey: ["series-order", "material-search", search, page] as const,
    });
const saveOrderSpy = fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    Response.json({ kind: "saved", orderVersion: "b".repeat(64) }),
  ),
);
const failedOrderSpy = fn((_input: RequestInfo | URL, _init?: RequestInit) =>
  Promise.resolve(
    Response.json({ kind: "error", reference: "series-order-save" }),
  ),
);

const meta = {
  args: {
    createMaterialSearchQueryOptions,
    onBack: fn(),
    onRefresh: fn(),
    onSelectPlaylist: fn(),
    presentation: {
      archived: false,
      items: [
        {
          materialId: "95000000-0000-4000-8000-000000000001",
          publicationState: "published",
          title: "С чего начинается Platform Inside",
        },
        {
          materialId: "95000000-0000-4000-8000-000000000002",
          publicationState: "draft",
          title: "Границы продукта и первая версия",
        },
        {
          materialId: "95000000-0000-4000-8000-000000000003",
          publicationState: "unpublished",
          title: "Как устроена база знаний",
        },
      ],
      name: "Создание Platform Inside",
      options: [
        {
          label: "Создание Platform Inside",
          value: "95000000-0000-4000-8000-000000000010",
        },
      ],
      orderVersion: "a".repeat(64),
      seriesId: "95000000-0000-4000-8000-000000000010",
    },
  },
  component: SeriesOrderManager,
  parameters: { nextjs: { appDirectory: true } },
  title: "Pages/Authoring/Руководства",
} satisfies Meta<typeof SeriesOrderManager>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reordering: Story = {
  decorators: [withMutationFetch(saveOrderSpy)],
  play: async ({ canvasElement }) => {
    saveOrderSpy.mockClear();
    const canvas = within(canvasElement);
    await moveFirstItem(canvasElement);
    await expect(
      canvas.getByText("Есть несохранённые изменения."),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByText("Порядок сохранён."),
    ).toBeInTheDocument();
    await expect(saveOrderSpy).toHaveBeenCalledOnce();
    await moveFirstItem(canvasElement);
    await waitFor(() => expect(saveOrderSpy).toHaveBeenCalledTimes(2));
    const secondBody = saveOrderSpy.mock.calls[1]?.[1]?.body;
    await expect(secondBody).toBeInstanceOf(FormData);
    if (secondBody instanceof FormData) {
      await expect(secondBody.get("expectedOrderVersion")).toBe("b".repeat(64));
    }
  },
};

export const StepAssignments: Story = {
  decorators: [withMutationFetch(saveOrderSpy)],
  play: async ({ canvasElement }) => {
    saveOrderSpy.mockClear();
    const canvas = within(canvasElement);
    const disclosure = canvas.getAllByText("Последовательность шагов")[0];
    if (disclosure === undefined) throw new Error("Missing step disclosure");
    await userEvent.click(disclosure);
    const input = canvas.getAllByRole("textbox", {
      name: "Название последовательности",
    })[0];
    if (input === undefined)
      throw new Error("Step assignment field is missing");
    await userEvent.type(input, "От проекта до релиза");
    await expect(
      await canvas.findByText("Порядок сохранён."),
    ).toBeInTheDocument();
    const body = saveOrderSpy.mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData))
      throw new Error("Expected composition form");
    await expect(body.get("stepGroups")).toBe(
      JSON.stringify({
        "95000000-0000-4000-8000-000000000001": "От проекта до релиза",
      }),
    );
    await userEvent.clear(input);
    await waitFor(() => expect(saveOrderSpy).toHaveBeenCalledTimes(2));
    const cleared = saveOrderSpy.mock.calls[1]?.[1]?.body;
    if (!(cleared instanceof FormData)) throw new Error("Expected clear form");
    await expect(cleared.get("stepGroups")).toBe("{}");
  },
};

export const Empty: Story = {
  args: {
    presentation: { ...meta.args.presentation, items: [] },
  },
};

export const AddMaterial: Story = {
  play: async ({ canvasElement }) => {
    loadMaterialsSpy.mockClear();
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", { name: "Добавить материал" }),
    );
    const dialog = canvas.getByRole("dialog", { name: "Добавить материал" });
    await expect(dialog).toBeVisible();
    await expect(
      await within(dialog).findByRole("button", {
        name: "Добавить «Материал вне руководства»",
      }),
    ).toBeVisible();
    await expect(loadMaterialsSpy).toHaveBeenCalledOnce();
  },
};

export const Archived: Story = {
  args: {
    presentation: { ...meta.args.presentation, archived: true },
  },
};

export const Conflict: Story = {
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(Response.json({ kind: "conflict" })),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await moveFirstItem(canvasElement);
    await expect(
      await canvas.findByText("Состав или порядок изменился в другой вкладке."),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("button", { name: "Обновить список" }),
    ).toBeVisible();
  },
};

export const SaveError: Story = {
  decorators: [withMutationFetch(failedOrderSpy)],
  play: async ({ canvasElement }) => {
    failedOrderSpy.mockClear();
    const canvas = within(canvasElement);
    await moveFirstItem(canvasElement);
    await expect(
      await canvas.findByText(/Не удалось сохранить/u),
    ).toBeInTheDocument();
    const retry = await canvas.findByRole("button", {
      name: "Повторить сохранение",
    });
    await expect(retry).toBeEnabled();
    await userEvent.click(retry);
    await expect(failedOrderSpy).toHaveBeenCalledTimes(2);
  },
};

export const SessionExpired: Story = {
  decorators: [
    withMutationFetch(() =>
      Promise.resolve(Response.json({ kind: "unauthorized" })),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await moveFirstItem(canvasElement);
    await expect(
      await canvas.findByText(/Сессия завершилась/u),
    ).toBeInTheDocument();
    await expect(
      await canvas.findByRole("button", { name: "Войти" }),
    ).toBeVisible();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile320" } },
};

async function moveFirstItem(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  await userEvent.click(
    canvas.getByRole("button", {
      name: "Опустить «С чего начинается Platform Inside»",
    }),
  );
}
