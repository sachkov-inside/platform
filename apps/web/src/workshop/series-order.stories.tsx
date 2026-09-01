import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  SeriesOrderManager,
} from "@/features/series-order";
import { withMutationFetch } from "./mutation-mock";

const saveOrderSpy = fn(() =>
  Promise.resolve(Response.json({ kind: "saved", orderVersion: "b".repeat(64) })),
);
const failedOrderSpy = fn(() =>
  Promise.resolve(Response.json({ kind: "error", reference: "series-order-save" })),
);

const meta = {
  args: {
    onBack: fn(),
    onRefresh: fn(),
    onSelectPlaylist: fn(),
    presentation: {
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
  title: "Pages/Authoring/Плейлисты",
} satisfies Meta<typeof SeriesOrderManager>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reordering: Story = {
  decorators: [withMutationFetch(saveOrderSpy)],
  play: async ({ canvasElement }) => {
    saveOrderSpy.mockClear();
    const canvas = within(canvasElement);
    await moveFirstItem(canvasElement);
    await expect(canvas.getByText("Есть несохранённые изменения.")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить порядок" }));
    await expect(await canvas.findByText("Порядок сохранён.")).toBeInTheDocument();
    await expect(saveOrderSpy).toHaveBeenCalledOnce();
  },
};

export const Empty: Story = {
  args: {
    presentation: { ...meta.args.presentation, items: [] },
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
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить порядок" }));
    await expect(
      await canvas.findByText("Состав или порядок изменился в другой вкладке."),
    ).toBeInTheDocument();
    await expect(await canvas.findByRole("button", { name: "Обновить список" })).toBeVisible();
  },
};

export const SaveError: Story = {
  decorators: [withMutationFetch(failedOrderSpy)],
  play: async ({ canvasElement }) => {
    failedOrderSpy.mockClear();
    const canvas = within(canvasElement);
    await moveFirstItem(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить порядок" }));
    await expect(await canvas.findByText(/Не удалось сохранить/u)).toBeInTheDocument();
    const retry = await canvas.findByRole("button", { name: "Повторить сохранение" });
    await expect(retry).toBeVisible();
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
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить порядок" }));
    await expect(await canvas.findByText(/Сессия завершилась/u)).toBeInTheDocument();
    await expect(await canvas.findByRole("button", { name: "Войти" })).toBeVisible();
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
