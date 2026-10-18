import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { ProgrammePlacementsEditor } from "./programme-placements-editor.client";
import { authoringPageEnvironment } from "@/storybook/story-environment";
import { fetchBeforeRender } from "@/storybook/mutation-mock";

const productId = "95000000-0000-4000-8000-000000000010";
const materialId = "95000000-0000-4000-8000-000000000001";
const chapterId = "95000000-0000-4000-8000-000000000020";
const placementId = "95000000-0000-4000-8000-000000000030";
const order = {
  archived: false,
  seriesId: productId,
  name: "Курс",
  orderVersion: "a".repeat(64),
  chapters: [{ id: chapterId, name: "Первая глава", summary: "" }],
  items: [
    {
      materialId,
      title: "Общий материал",
      chapterId,
      stepGroup: null,
      publicationState: "published",
    },
  ],
  programmePlacements: [
    { id: placementId, materialId, chapterId, stepGroup: null },
  ],
};
const meta = {
  ...authoringPageEnvironment(`/authoring/products/${productId}`),
  title: "Features/Series order/Programme placements",
  component: ProgrammePlacementsEditor,
  args: { productId, onClose: () => undefined },
  beforeEach: fetchBeforeRender((_input, init) =>
    Promise.resolve(
      init?.method === "PUT"
        ? Response.json({ kind: "saved", orderVersion: "b".repeat(64) })
        : Response.json({ kind: "ready", order }),
    ),
  ),
} satisfies Meta<typeof ProgrammePlacementsEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const RepeatedPlacement: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("1. Общий материал");
    await userEvent.click(
      canvas.getByRole("button", { name: "Добавить размещение" }),
    );
    await expect(canvas.getByText("2. Общий материал")).toBeVisible();
    const remove = canvas.getAllByRole("button", {
      name: "Убрать размещение",
    })[0];
    if (remove === undefined)
      throw new Error("Missing remove placement button");
    await userEvent.click(remove);
    await waitFor(() =>
      expect(canvas.queryByText("2. Общий материал")).toBeNull(),
    );
    await expect(canvas.getByText("1. Общий материал")).toBeVisible();
  },
};
export const Mobile: Story = {
  globals: { viewport: { value: "mobile390", isRotated: false } },
};
