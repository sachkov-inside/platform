import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { MaterialDocumentEditor } from "./material-document-editor.client";

const meta = {
  title: "Widgets/Material document editor",
  component: MaterialDocumentEditor,
  decorators: [
    (Story) => (
      <main className="mx-auto max-w-3xl p-5">
        <h1 id="document-heading">Содержимое материала</h1>
        <Story />
      </main>
    ),
  ],
  args: {
    disabled: false,
    materialId: null,
    onChange: fn(),
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Перед видео" }] },
        {
          type: "video",
          attrs: {
            description: "Демонстрационная запись",
            chapters: [{ start: 0, title: "Введение" }],
          },
        },
        { type: "paragraph", content: [{ type: "text", text: "После видео" }] },
      ],
    },
  },
} satisfies Meta<typeof MaterialDocumentEditor>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Video: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const description = await canvas.findByLabelText("Описание видео");
    await userEvent.clear(description);
    await userEvent.type(description, "Описание записи");
    await userEvent.click(
      canvas.getByRole("button", { name: "Добавить таймкод" }),
    );
    await expect(canvas.getByLabelText("Начало главы 2, секунды")).toHaveValue(
      60,
    );
    await expect(args.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: "video",
            attrs: expect.objectContaining({
              description: "Описание записи",
              chapters: [
                { start: 0, title: "Введение" },
                { start: 60, title: "Новая глава" },
              ],
            }),
          }),
        ]),
      }),
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "Убрать блок видео" }),
    );
    await expect(
      canvas.queryByLabelText("Описание видео"),
    ).not.toBeInTheDocument();
    await expect(canvas.getByText("Перед видео")).toBeVisible();
    await expect(canvas.getByText("После видео")).toBeVisible();
  },
};
export const VideoMobile: Story = {
  globals: { viewport: { isRotated: false, value: "mobile390" } },
};
