import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { MaterialBodyView } from "./material-body-view";

const meta = {
  component: MaterialBodyView,
  title: "Entities/Material Body",
  args: {
    blocks: [
      {
        kind: "paragraph",
        content: [
          {
            kind: "text",
            text: "Текст с пояснением",
            marks: [{ kind: "bold" }],
          },
        ],
      },
      { kind: "code_block", text: "const result = 1;" },
    ],
    path: [],
    rendering: {
      headingId: (path: readonly number[]) =>
        `material-section-${path.join("-")}`,
      image: () => null,
      file: () => null,
    },
  },
} satisfies Meta<typeof MaterialBodyView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Document: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Текст с пояснением")).toBeVisible();
    await expect(canvas.getByText("const result = 1;")).toBeVisible();
  },
};
