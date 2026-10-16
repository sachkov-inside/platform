import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ChapterAttachmentsEditor } from "./chapter-attachments-editor.client";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { fetchBeforeRender } from "@/storybook/mutation-mock";

const materialId = "95000000-0000-4000-8000-000000000001";
const meta = {
  ...authoringPageEnvironment(
    "/authoring/products/95000000-0000-4000-8000-000000000010",
  ),
  title: "Features/Series order/Chapter attachments",
  component: ChapterAttachmentsEditor,
  args: {
    productId: "95000000-0000-4000-8000-000000000010",
    orderVersion: "a".repeat(64),
    chapter: {
      id: "95000000-0000-4000-8000-000000000020",
      name: "Первая глава",
      summary: "",
      supplementaryMaterialIds: [materialId],
    },
    items: [
      { materialId, title: "Описание проекта", publicationState: "published" },
    ],
    onRefresh: () => undefined,
  },
  beforeEach: fetchBeforeRender(() =>
    Promise.resolve(
      Response.json({ kind: "saved", orderVersion: "b".repeat(64) }),
    ),
  ),
} satisfies Meta<typeof ChapterAttachmentsEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Attached: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByText("Дополнительные материалы · Первая глава"),
    );
    await expect(canvas.getByText("Описание проекта")).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "Убрать привязку" }),
    ).toBeVisible();
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
