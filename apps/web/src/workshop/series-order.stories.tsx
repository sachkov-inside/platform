import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import {
  SeriesOrderManager,
  type SeriesOrderMutation,
} from "@/features/series-order";

const saveOrderSpy = fn();
const saveOrder: SeriesOrderMutation = (state, formData) => {
  saveOrderSpy(state, formData);
  return Promise.resolve({ kind: "saved", orderVersion: "b".repeat(64) });
};

const meta = {
  args: {
    action: saveOrder,
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
          title: "Как устроена библиотека материалов",
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
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("button", {
        name: "Опустить «С чего начинается Platform Inside»",
      }),
    );
    await expect(canvas.getByText("Есть несохранённые изменения.")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Сохранить порядок" }));
    await expect(canvas.getByText("Порядок сохранён.")).toBeInTheDocument();
    await expect(saveOrderSpy).toHaveBeenCalledOnce();
  },
};

export const Mobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile320" } },
};
