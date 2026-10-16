import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { SeriesOrderPanel } from "./series-order-panel.client";
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

export const IndependentDrafts: Story = {
  render: () => (
    <SeriesOrderPanel
      seriesId="95000000-0000-4000-8000-000000000010"
      archived={false}
      readOnly
    />
  ),
  beforeEach: () => {
    let saved = false;
    return fetchBeforeRender((_input, init) => {
      if (init?.method === "PUT") {
        saved = true;
        return Promise.resolve(
          Response.json({ kind: "saved", orderVersion: "b".repeat(64) }),
        );
      }
      return Promise.resolve(
        Response.json({
          kind: "ready",
          order: {
            archived: false,
            seriesId: "95000000-0000-4000-8000-000000000010",
            name: "Курс",
            orderVersion: (saved ? "b" : "a").repeat(64),
            programmePlacements: [],
            items: [
              {
                materialId,
                title: "Описание проекта",
                publicationState: "published",
                chapterId: null,
                stepGroup: null,
              },
            ],
            chapters: [
              {
                id: "95000000-0000-4000-8000-000000000020",
                name: saved ? "Первая глава сохранена" : "Первая глава",
                summary: "",
                supplementaryMaterialIds: saved ? [] : [materialId],
              },
              {
                id: "95000000-0000-4000-8000-000000000021",
                name: "Вторая глава",
                summary: "",
                supplementaryMaterialIds: [],
              },
            ],
          },
        }),
      );
    })();
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const firstSummary = await canvas.findByText(
      "Дополнительные материалы · Первая глава",
    );
    const secondSummary = canvas.getByText(
      "Дополнительные материалы · Вторая глава",
    );
    const firstDetails = firstSummary.closest("details");
    const secondDetails = secondSummary.closest("details");
    if (firstDetails === null || secondDetails === null)
      throw new Error("Missing chapter attachment editors");
    await userEvent.click(firstSummary);
    await userEvent.click(secondSummary);
    const first = within(firstDetails);
    const second = within(secondDetails);
    await userEvent.click(
      second.getByRole("button", { name: "Описание проекта" }),
    );
    await userEvent.click(
      first.getByRole("button", { name: "Убрать привязку" }),
    );
    await userEvent.click(
      first.getByRole("button", { name: "Сохранить привязки" }),
    );
    await canvas.findByText(
      "Дополнительные материалы · Первая глава сохранена",
    );
    await expect(
      second.getByRole("button", { name: "Убрать привязку" }),
    ).toBeVisible();
    await expect(
      second.getByRole("button", { name: "Сохранить привязки" }),
    ).toBeEnabled();
  },
};
